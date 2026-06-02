import { storageConfig } from "./config.mjs";
import { StorageFile } from "./storage-file.mjs";
import { ScopedStorage } from "./scoped-storage.mjs";
import { storageDriverContext } from "./context/storage-driver-context.mjs";
import { DOSpacesDriver } from "./drivers/do-spaces-driver.mjs";
import { LocalDriver } from "./drivers/local-driver.mjs";
import { R2Driver } from "./drivers/r2-driver.mjs";
import { S3Driver } from "./drivers/s3-driver.mjs";
import path from "path";
import events from "@mongez/events";
import fs from "fs";
//#region ../../@warlock.js/core/src/storage/storage.ts
/**
* Storage Manager
*
* Provides a unified interface for file storage operations across multiple
* drivers (local, S3, R2, DigitalOcean Spaces). Extends `ScopedStorage` to
* inherit all base operations while adding driver management and events.
*
* All operations return `StorageFile` instances for a consistent, rich DX.
*
* @example
* ```typescript
* // Basic usage (uses default driver)
* const file = await storage.put(buffer, "uploads/image.jpg");
*
* // With options
* const file = await storage.put(buffer, "uploads/image.jpg", {
*   mimeType: "image/jpeg",
*   cacheControl: "max-age=31536000"
* });
*
* // Using specific driver (also returns StorageFile)
* const file = await storage.use("s3").put(buffer, "path/to/file");
*
* // Get raw driver for advanced use
* const driver = storage.driver("s3");
* const data = await driver.put(buffer, "path/to/file"); // Returns StorageFileData
*
* // Stream operations for large files
* const stream = await storage.getStream("large-file.zip");
* await storage.putStream(readableStream, "output/file.zip");
*
* // Batch operations
* const results = await storage.deleteMany(["file1.txt", "file2.txt"]);
*
* // Event hooks
* storage.on("afterPut", ({ location, file }) => {
*   console.log(`Uploaded ${location}`);
* });
* ```
*/
var Storage = class extends ScopedStorage {
	/**
	* Create a new Storage manager instance
	*
	* Uses lazy initialization - driver is resolved on first access.
	*/
	constructor() {
		super(null);
		this.drivers = /* @__PURE__ */ new Map();
		this.configs = /* @__PURE__ */ new Map();
		this.initialized = false;
	}
	/**
	* Ensure storage is initialized (lazy initialization)
	*
	* Called automatically on first driver access.
	*/
	async init() {
		if (this.initialized) return;
		this.initialized = true;
		const defaultName = storageConfig("default", "local");
		this.defaultDriverName = defaultName;
		this.loadDriversFromConfig();
		this._driver = this.resolveDriver(this.defaultDriverName);
	}
	/**
	* Reset storage defaults
	*/
	reset() {
		this.initialized = false;
		this.drivers.clear();
		this.configs.clear();
		this.defaultDriverName = null;
		this._driver = null;
	}
	/**
	* Get the currently active driver (context-aware in future)
	*
	* Currently returns the default driver.
	* Will be enhanced to check AsyncLocalStorage context for multi-tenant support.
	*
	* @returns The active storage driver
	*/
	get activeDriver() {
		const contextDriver = storageDriverContext.getDriver();
		if (contextDriver) return contextDriver;
		return this._driver;
	}
	/**
	* Load drivers from configuration
	* @internal
	*/
	loadDriversFromConfig() {
		const drivers = storageConfig("drivers", {});
		for (const [name, config] of Object.entries(drivers)) this.configs.set(name, config);
	}
	/**
	* Get a scoped storage for a specific driver
	*
	* Returns a `ScopedStorage` instance that wraps the specified driver.
	* Operations on the returned instance also return `StorageFile` objects.
	*
	* @param name - Driver name as defined in configuration
	* @returns ScopedStorage instance for the specified driver
	*
	* @example
	* ```typescript
	* // Upload to S3
	* const s3File = await storage.use("s3").put(buffer, "images/photo.jpg");
	*
	* // Upload to local
	* const localFile = await storage.use("local").put(buffer, "temp/file.txt");
	*
	* // Both return StorageFile with identical API
	* console.log(s3File.url);
	* console.log(localFile.url);
	* ```
	*/
	use(name) {
		return new ScopedStorage(this.getDriver(name));
	}
	/**
	* Get a raw driver instance
	*
	* Returns the underlying driver directly for advanced use cases.
	* Unlike `use()`, calling methods on the raw driver returns
	* `StorageFileData` instead of `StorageFile`.
	*
	* @param name - Driver name as defined in configuration
	* @returns Raw driver instance implementing StorageDriverContract
	*
	* @example
	* ```typescript
	* const driver = storage.getDriver("s3");
	* const data = await driver.put(buffer, "path/to/file");
	* // data is StorageFileData, not StorageFile
	* ```
	*/
	getDriver(name) {
		return this.resolveDriver(name);
	}
	/**
	* Get root directory of current driver
	*/
	root(apepndedPath) {
		const rootPath = this.activeDriver.options?.root || "";
		return path.join(rootPath, apepndedPath || "");
	}
	/**
	* Use a cloud storage driver with extended cloud capabilities
	*
	* @param name - Cloud driver name (s3, r2, spaces)
	* @returns Driver instance implementing CloudStorageDriverContract
	* @throws Error if driver doesn't support cloud operations
	*
	* @example
	* ```typescript
	* const cloudDriver = storage.useCloud("s3");
	* const presignedUrl = await cloudDriver.getPresignedUrl("private/doc.pdf");
	* ```
	*/
	useCloud(name) {
		const instance = this.getDriver(name);
		if (!this.isCloudDriver(instance)) throw new Error(`Driver "${name}" does not support cloud operations`);
		return instance;
	}
	/**
	* Register a new driver configuration at runtime
	*
	* Allows dynamic driver registration for multi-tenancy or
	* runtime configuration scenarios.
	*
	* @param name - Unique driver name
	* @param config - Driver configuration
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* storage.register("tenant-s3", {
	*   driver: "s3",
	*   bucket: "tenant-bucket",
	*   region: "us-east-1",
	*   accessKeyId: process.env.TENANT_AWS_KEY,
	*   secretAccessKey: process.env.TENANT_AWS_SECRET
	* });
	*
	* await storage.use("tenant-s3").put(buffer, "file.txt");
	* ```
	*/
	register(name, config) {
		this.configs.set(name, config);
		this.drivers.delete(name);
		return this;
	}
	/**
	* Set the default driver name
	*
	* @param name - Driver name to use as default
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* storage.setDefault("s3");
	* await storage.put(buffer, "file.txt"); // Now uses S3
	* ```
	*/
	setDefault(name) {
		this.defaultDriverName = name;
		this._driver = this.getDriver(name);
		return this;
	}
	/**
	* Check if current driver is a cloud driver
	*
	* @returns Promise resolving to true if the current driver supports cloud operations
	*/
	async isCloud() {
		return this.isCloudDriver(this.activeDriver);
	}
	/**
	* Check if a driver instance supports cloud operations
	* @internal
	*/
	isCloudDriver(driver) {
		return "getPresignedUrl" in driver;
	}
	/**
	* Register an event handler
	*
	* Subscribe to storage events for logging, analytics, or side effects.
	*
	* @param event - Event type to listen for
	* @param handler - Handler function
	* @returns Event subscription for unsubscribing
	*
	* @example
	* ```typescript
	* // Log all uploads
	* storage.on("afterPut", ({ location, file }) => {
	*   console.log(`Uploaded ${file?.size} bytes to ${location}`);
	* });
	*
	* // Track deletions
	* storage.on("afterDelete", ({ location }) => {
	*   analytics.track("file_deleted", { path: location });
	* });
	* ```
	*/
	on(event, handler) {
		return events.subscribe(`storage.${event}`, handler);
	}
	/**
	* Remove all handlers for an event type
	*
	* @param event - Event type to remove handlers for
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* storage.off("afterPut"); // Remove all afterPut handlers
	* ```
	*/
	off(event) {
		events.off(`storage.${event}`);
		return this;
	}
	/**
	* Emit an event to all registered handlers
	* @internal
	*/
	async emit(event, payload) {
		await events.triggerAll(`storage.${event}`, payload);
	}
	/**
	* Store a file in storage
	*
	* Extends base `put()` with event emission for beforePut/afterPut hooks.
	*
	* @param file - File content as Buffer, string, UploadedFile, or Readable stream
	* @param location - Destination path
	* @param options - Storage options (mimeType, cacheControl, etc.)
	* @returns StorageFile instance with cached metadata
	*/
	async put(file, location, options) {
		const driver = this.activeDriver;
		const buffer = await this.toBuffer(file);
		await this.emit("beforePut", {
			driver: driver.name,
			location,
			timestamp: /* @__PURE__ */ new Date(),
			size: buffer.length
		});
		const result = await driver.put(buffer, location, options);
		await this.emit("afterPut", {
			driver: driver.name,
			location,
			timestamp: /* @__PURE__ */ new Date(),
			file: result
		});
		if (!result.size) result.size = buffer.length;
		return StorageFile.fromData(result, driver);
	}
	/**
	* Store a file from a readable stream (for large files)
	*
	* Extends base `putStream()` with event emission.
	*
	* @param stream - Readable stream
	* @param location - Destination path
	* @param options - Storage options
	* @returns StorageFile instance with cached metadata
	*/
	async putStream(stream, location, options) {
		const driver = this.activeDriver;
		await this.emit("beforePut", {
			driver: driver.name,
			location,
			timestamp: /* @__PURE__ */ new Date()
		});
		if (typeof stream === "string") stream = fs.createReadStream(stream);
		const result = await driver.putStream(stream, location, options);
		await this.emit("afterPut", {
			driver: driver.name,
			location,
			timestamp: /* @__PURE__ */ new Date(),
			file: result
		});
		return StorageFile.fromData(result, driver);
	}
	/**
	* Store a file from a URL
	*
	* Downloads content from the URL and stores it at the specified location.
	*
	* @param url - Source URL to download from
	* @param location - Destination path
	* @param options - Storage options
	* @returns StorageFile instance with cached metadata
	*
	* @example
	* ```typescript
	* const file = await storage.putFromUrl(
	*   "https://example.com/image.jpg",
	*   "downloads/image.jpg"
	* );
	* ```
	*/
	async putFromUrl(url, location, options) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch file from URL: ${response.statusText}`);
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const mimeType = options?.mimeType || response.headers.get("content-type") || void 0;
		return this.put(buffer, location, {
			...options,
			mimeType
		});
	}
	/**
	* Store a file from base64 encoded string
	*
	* Decodes base64 content (with optional data URL prefix) and stores it.
	*
	* @param base64 - Base64 encoded file content (or data URL)
	* @param location - Destination path
	* @param options - Storage options
	* @returns StorageFile instance with cached metadata
	*
	* @example
	* ```typescript
	* // From plain base64
	* const file = await storage.putFromBase64(base64String, "images/photo.jpg");
	*
	* // From data URL (auto-extracts MIME type)
	* const file = await storage.putFromBase64(
	*   "data:image/png;base64,iVBORw0KGgo...",
	*   "images/photo.png"
	* );
	* ```
	*/
	async putFromBase64(base64, location, options) {
		let data = base64;
		let mimeType = options?.mimeType;
		if (base64.startsWith("data:")) {
			const match = base64.match(/^data:([^;]+);base64,(.+)$/);
			if (match) {
				mimeType = mimeType || match[1];
				data = match[2];
			}
		}
		const buffer = Buffer.from(data, "base64");
		return this.put(buffer, location, {
			...options,
			mimeType
		});
	}
	/**
	* Retrieve file contents as Buffer
	*
	* Uses the current driver (with async resolution).
	*
	* @param location - File path
	* @returns Buffer containing file contents
	*/
	async get(location) {
		return this.activeDriver.get(location);
	}
	/**
	* Get JSON content from a file
	*
	* Downloads and parses JSON file content.
	*
	* @param location - File path
	* @returns Parsed JSON content
	*
	* @example
	* ```typescript
	* const config = await storage.getJson("config/settings.json");
	* console.log(config.apiKey);
	* ```
	*/
	async getJson(location) {
		const buffer = await this.get(location);
		return JSON.parse(buffer.toString());
	}
	/**
	* Retrieve a file as a readable stream (for large files)
	*
	* @param location - File path
	* @returns Readable stream of file contents
	*/
	async getStream(location) {
		return this.activeDriver.getStream(location);
	}
	/**
	* Delete a file
	*
	* Extends base `delete()` with event emission.
	*
	* @param location - File path or StorageFile
	* @returns true if deleted, false if not found
	*/
	async delete(location) {
		const driver = this.activeDriver;
		const path = typeof location === "string" ? location : location.path;
		await this.emit("beforeDelete", {
			driver: driver.name,
			location: path,
			timestamp: /* @__PURE__ */ new Date()
		});
		const result = await driver.delete(path);
		await this.emit("afterDelete", {
			driver: driver.name,
			location: path,
			timestamp: /* @__PURE__ */ new Date()
		});
		return result;
	}
	/**
	* Delete multiple files at once
	*
	* @param locations - Array of file paths
	* @returns Array of delete results with status for each file
	*/
	async deleteMany(locations) {
		return this.activeDriver.deleteMany(locations);
	}
	/**
	* Check if a file exists
	*
	* @param location - File path
	* @returns true if file exists
	*/
	async exists(location) {
		return this.activeDriver.exists(location);
	}
	/**
	* Copy a file to a new location
	*
	* Extends base `copy()` with event emission.
	*
	* @param from - Source path or StorageFile
	* @param to - Destination path
	* @returns StorageFile instance at destination
	*/
	async copy(from, to) {
		const driver = this.activeDriver;
		const fromPath = typeof from === "string" ? from : from.path;
		await this.emit("beforeCopy", {
			driver: driver.name,
			location: to,
			from: fromPath,
			to,
			timestamp: /* @__PURE__ */ new Date()
		});
		const result = await driver.copy(fromPath, to);
		await this.emit("afterCopy", {
			driver: driver.name,
			location: to,
			from: fromPath,
			to,
			timestamp: /* @__PURE__ */ new Date(),
			file: result
		});
		return StorageFile.fromData(result, driver);
	}
	/**
	* Move a file to a new location
	*
	* Extends base `move()` with event emission.
	*
	* @param from - Source path or StorageFile
	* @param to - Destination path
	* @returns StorageFile instance at destination
	*/
	async move(from, to) {
		const driver = this.activeDriver;
		const fromPath = typeof from === "string" ? from : from.path;
		await this.emit("beforeMove", {
			driver: driver.name,
			location: to,
			from: fromPath,
			to,
			timestamp: /* @__PURE__ */ new Date()
		});
		const result = await driver.move(fromPath, to);
		await this.emit("afterMove", {
			driver: driver.name,
			location: to,
			from: fromPath,
			to,
			timestamp: /* @__PURE__ */ new Date(),
			file: result
		});
		return StorageFile.fromData(result, driver);
	}
	/**
	* List files in a directory
	*
	* @param directory - Directory path (defaults to root)
	* @param options - List options (recursive, limit, etc.)
	* @returns Array of file information objects
	*/
	async list(directory, options) {
		return this.activeDriver.list(directory || "", options);
	}
	/**
	* Get file metadata without downloading
	*
	* @param location - File path
	* @returns File information object
	*/
	async metadata(location) {
		return this.activeDriver.metadata(location);
	}
	/**
	* Get file size in bytes
	*
	* @param location - File path
	* @returns File size in bytes
	*/
	async size(location) {
		return this.activeDriver.size(location);
	}
	/**
	* Get the absolute filesystem path for a location
	*
	* Only available for local driver.
	*
	* @param location - File path
	* @throws Error if current driver is not a local driver
	* @returns Absolute filesystem path
	*/
	async path(location) {
		const driver = this.activeDriver;
		if (!("path" in driver) || typeof driver.path !== "function") throw new Error("path() is only available for local storage drivers");
		return driver.path(location);
	}
	/**
	* Get a presigned URL for downloading a file
	*
	* Only available for cloud drivers.
	*
	* @param location - File path
	* @param options - Presigned URL options (expiresIn)
	* @throws Error if current driver is not a cloud driver
	* @returns Presigned download URL
	*
	* @example
	* ```typescript
	* const url = await storage.getPresignedUrl("private/document.pdf", {
	*   expiresIn: 3600 // 1 hour
	* });
	* ```
	*/
	async getPresignedUrl(location, options) {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Presigned URLs are only available for cloud storage drivers");
		return driver.getPresignedUrl(location, options);
	}
	/**
	* Get a presigned URL for uploading a file directly to cloud storage
	*
	* Only available for cloud drivers.
	*
	* @param location - Destination path
	* @param options - Upload options (expiresIn, contentType, maxSize)
	* @throws Error if current driver is not a cloud driver
	* @returns Presigned upload URL
	*
	* @example
	* ```typescript
	* const uploadUrl = await storage.getPresignedUploadUrl("uploads/file.pdf", {
	*   expiresIn: 3600,
	*   contentType: "application/pdf"
	* });
	*
	* // Client can PUT directly to this URL
	* ```
	*/
	async getPresignedUploadUrl(location, options) {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Presigned upload URLs are only available for cloud storage drivers");
		return driver.getPresignedUploadUrl(location, options);
	}
	/**
	* Get the bucket name for cloud storage
	*
	* Only available for cloud drivers.
	*
	* @throws Error if current driver is not a cloud driver
	* @returns Bucket name
	*/
	async getBucket() {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Bucket information is only available for cloud storage drivers");
		return driver.getBucket();
	}
	/**
	* Get the region for cloud storage
	*
	* Only available for cloud drivers.
	*
	* @throws Error if current driver is not a cloud driver
	* @returns Region name
	*/
	async getRegion() {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Region information is only available for cloud storage drivers");
		return driver.getRegion();
	}
	/**
	* Set storage class for a file (e.g., STANDARD, GLACIER, etc.)
	*
	* Only available for cloud drivers.
	*
	* @param location - File path
	* @param storageClass - Target storage class
	* @throws Error if current driver is not a cloud driver
	*/
	async setStorageClass(location, storageClass) {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Storage class is only available for cloud storage drivers");
		return driver.setStorageClass(location, storageClass);
	}
	/**
	* Set file visibility (public or private)
	*
	* Only available for cloud drivers.
	*
	* @param location - File path
	* @param visibility - "public" or "private"
	* @throws Error if current driver is not a cloud driver
	*/
	async setVisibility(location, visibility) {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Visibility is only available for cloud storage drivers");
		return driver.setVisibility(location, visibility);
	}
	/**
	* Get file visibility
	*
	* Only available for cloud drivers.
	*
	* @param location - File path
	* @throws Error if current driver is not a cloud driver
	* @returns Current visibility setting
	*/
	async getVisibility(location) {
		const driver = this.activeDriver;
		if (!this.isCloudDriver(driver)) throw new Error("Visibility is only available for cloud storage drivers");
		return driver.getVisibility(location);
	}
	/**
	* Get a temporary signed URL
	*
	* Creates a URL that provides temporary access to the file.
	*
	* @param location - File path
	* @param expiresIn - Seconds until expiration (default: 3600)
	* @returns Signed URL string
	*/
	async temporaryUrl(location, expiresIn) {
		return this.activeDriver.temporaryUrl(location, expiresIn);
	}
	/**
	* Validate a temporary URL token
	*
	* For local driver: validates HMAC-signed tokens
	* For cloud drivers: returns invalid (cloud validates via presigned URL)
	*
	* @param token - The token from the temporary URL
	* @returns Validation result with file info and convenience methods
	*
	* @example
	* ```typescript
	* const result = await storage.validateTemporaryToken(token);
	*
	* if (!result.valid) {
	*   return response.status(403).send(result.error);
	* }
	*
	* // For local driver - use sendFile for efficiency
	* if (result.absolutePath) {
	*   return response.sendFile(result.absolutePath);
	* }
	*
	* // For cloud driver - stream the file
	* const stream = await result.getStream!();
	* stream.pipe(response.raw);
	* ```
	*/
	async validateTemporaryToken(token) {
		if (!("validateTemporaryToken" in this.activeDriver) || typeof this.activeDriver.validateTemporaryToken !== "function") return {
			valid: false,
			error: "invalid_token"
		};
		return this.activeDriver.validateTemporaryToken(token);
	}
	/**
	* Parse config into driver-specific options
	* @internal
	*/
	parseOptions(config) {
		const { driver, ...options } = config;
		switch (driver) {
			case "local": return {
				root: options.root,
				urlPrefix: options.urlPrefix,
				signatureKey: options.signatureKey
			};
			case "s3":
				this.validateCloudConfig(config, "s3");
				return {
					...options,
					bucket: options.bucket,
					region: options.region,
					accessKeyId: options.accessKeyId,
					secretAccessKey: options.secretAccessKey,
					endpoint: options.endpoint,
					urlPrefix: options.urlPrefix
				};
			case "r2":
				this.validateCloudConfig(config, "r2");
				if (!options.accountId) throw new Error("R2 driver requires \"accountId\" configuration");
				return {
					...options,
					region: options.region || "auto",
					bucket: options.bucket,
					accessKeyId: options.accessKeyId,
					secretAccessKey: options.secretAccessKey,
					endpoint: options.endpoint,
					urlPrefix: options.urlPrefix,
					accountId: options.accountId,
					publicDomain: options.publicDomain
				};
			case "spaces":
				this.validateCloudConfig(config, "spaces");
				return {
					...options,
					bucket: options.bucket,
					region: options.region,
					accessKeyId: options.accessKeyId,
					secretAccessKey: options.secretAccessKey,
					endpoint: options.endpoint,
					urlPrefix: options.urlPrefix
				};
			default: throw new Error(`Unknown driver type: ${driver}`);
		}
	}
	/**
	* Validate cloud driver configuration has required fields
	* @internal
	*/
	validateCloudConfig(config, driverName) {
		const required = [
			"bucket",
			"accessKeyId",
			"secretAccessKey"
		];
		if (driverName !== "r2") required.push("region");
		for (const field of required) if (!config[field]) throw new Error(`${driverName.toUpperCase()} driver requires "${field}" configuration`);
	}
	/**
	* Get or create driver instance from cache
	* @internal
	*/
	resolveDriver(name) {
		if (this.drivers.has(name)) return this.drivers.get(name);
		const config = this.configs.get(name);
		if (!config) throw new Error(`Storage driver "${name}" is not configured`);
		const options = this.parseOptions(config);
		let driver;
		switch (config.driver) {
			case "local":
				driver = new LocalDriver(options);
				break;
			case "s3":
				driver = new S3Driver(options);
				break;
			case "r2":
				driver = new R2Driver(options);
				break;
			case "spaces":
				driver = new DOSpacesDriver(options);
				break;
			default: throw new Error(`Unknown storage driver type: ${config.driver}`);
		}
		this.drivers.set(name, driver);
		return driver;
	}
	/**
	* Resolve the default driver name (supports async resolver for multi-tenancy)
	* @internal
	*/
	async resolveDefaultDriver() {
		const resolver = storageConfig("resolver");
		if (resolver) return await resolver() || this.defaultDriverName;
		return this.defaultDriverName;
	}
};
/**
* Singleton storage instance
*
* Pre-configured storage manager ready for use throughout the application.
*
* @example
* ```typescript
* import { storage } from "@warlock.js/core";
*
* const file = await storage.put(buffer, "uploads/file.txt");
* ```
*/
const storage = new Storage();
//#endregion
export { Storage, storage };

//# sourceMappingURL=storage.mjs.map