import { storageDriverContext } from "../context/storage-driver-context.mjs";
import { getMimeType } from "../utils/mime.mjs";
import crypto from "crypto";
//#region ../../@warlock.js/core/src/storage/drivers/cloud-driver.ts
/**
* Cached S3 SDK modules (loaded once, reused)
*/
let S3Client;
let S3Storage;
let S3Presigner;
let isModuleExists = null;
/**
* Installation instructions for S3 SDK packages
*/
const S3_INSTALL_INSTRUCTIONS = `
Cloud storage requires the AWS S3 SDK packages.
Install them with:

  npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner

Or with your preferred package manager:

  pnpm add @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
  yarn add @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
`.trim();
/**
* Atomic initialization promise to handle concurrent calls to loadS3
*/
let initializationPromise = null;
/**
* Load S3 modules lazily
*
* @example
* await loadS3();
* if (isModuleExists) {
*   // Safe to use S3Client, S3Storage, S3Presigner
* }
*/
async function loadS3() {
	if (isModuleExists === true) return;
	if (initializationPromise) return initializationPromise;
	initializationPromise = (async () => {
		try {
			const [client, storage, presigner] = await Promise.all([
				import("@aws-sdk/client-s3"),
				import("@aws-sdk/lib-storage"),
				import("@aws-sdk/s3-request-presigner")
			]);
			S3Client = client;
			S3Storage = storage;
			S3Presigner = presigner;
			isModuleExists = true;
		} catch {
			isModuleExists = false;
		}
	})();
	return initializationPromise;
}
loadS3();
/**
* Base abstract class for all S3-compatible cloud storage drivers
*
* This class contains all shared logic for S3-compatible storage services
* including AWS S3, Cloudflare R2, DigitalOcean Spaces, and others.
*
* **Important:** S3 SDK packages are lazy-loaded on first use.
* Users must install them separately:
* ```
* npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
* ```
*
* Subclasses must implement:
* - `name`: Driver identifier (e.g., "s3", "r2", "spaces")
* - `url()`: Returns the public URL for a file (provider-specific format)
*/
var CloudDriver = class {
	constructor(options) {
		this.options = options;
		if (!isModuleExists) throw new Error(S3_INSTALL_INSTRUCTIONS);
		this.client = new S3Client.S3Client({
			region: this.options.region,
			credentials: {
				accessKeyId: this.options.accessKeyId,
				secretAccessKey: this.options.secretAccessKey
			},
			...this.getEndpoint() && { endpoint: this.getEndpoint() }
		});
		this.retryConfig = {
			maxRetries: this.options.retry?.maxRetries ?? 3,
			initialDelayMs: this.options.retry?.initialDelayMs ?? 1e3,
			maxDelayMs: this.options.retry?.maxDelayMs ?? 1e4,
			backoffMultiplier: this.options.retry?.backoffMultiplier ?? 2
		};
	}
	/**
	* Get endpoint URL
	* Can be overridden by subclasses for provider-specific endpoints
	*/
	getEndpoint() {
		return this.options.endpoint;
	}
	/**
	* Apply prefix to location path
	*
	* Priority: context prefix > driver options prefix > no prefix
	* This allows multi-tenant scenarios where context overrides driver config.
	*
	* @param location - Original location path
	* @returns Location with prefix applied if one exists
	*/
	applyPrefix(location) {
		const prefix = storageDriverContext.getPrefix() || this.options.prefix;
		if (!prefix) return location;
		const cleanPrefix = prefix.replace(/\/+$/, "");
		const cleanLocation = location.replace(/^\/+/, "");
		if (cleanLocation.startsWith(cleanPrefix + "/") || cleanLocation === cleanPrefix) return cleanLocation;
		return `${cleanPrefix}/${cleanLocation}`;
	}
	/**
	* Normalize storage path (remove double slashes, sanitize)
	* @internal
	*/
	normalizePath(path) {
		return path.replace(/\/+/g, "/").replace(/^\//, "").trim();
	}
	/**
	* Execute an operation with retry logic
	*
	* Retries on transient errors with exponential backoff.
	*
	* @param operation - Async operation to execute
	* @param operationName - Name for logging
	* @returns Result of the operation
	* @internal
	*/
	async withRetry(operation, operationName = "operation") {
		const { maxRetries, initialDelayMs, backoffMultiplier, maxDelayMs } = this.retryConfig;
		let lastError;
		for (let attempt = 0; attempt < maxRetries; attempt++) try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt === maxRetries - 1) break;
			if (!this.isRetryableError(error)) throw error;
			const delayMs = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError?.message}`);
	}
	/**
	* Check if an error is retryable
	*
	* Retries on:
	* - Network errors
	* - 5xx server errors
	* - Rate limiting (429)
	* - Timeout errors
	*
	* Does NOT retry on:
	* - 4xx client errors (except 429)
	* - Authentication errors
	* - Not found errors
	*
	* @param error - Error to check
	* @returns true if error is retryable
	* @internal
	*/
	isRetryableError(error) {
		if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") return true;
		if (error.name === "NetworkingError" || error.name === "TimeoutError") return true;
		const statusCode = error.$metadata?.httpStatusCode || error.statusCode;
		if (statusCode) {
			if (statusCode >= 500 && statusCode < 600) return true;
			if (statusCode === 429) return true;
		}
		return false;
	}
	/**
	* Put file to cloud storage
	*/
	async put(file, location, options) {
		return this.withRetry(async () => {
			const { PutObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const hash = this.calculateHash(file);
			const mimeType = options?.mimeType || this.guessMimeType(location);
			const command = new PutObjectCommand({
				Bucket: this.options.bucket,
				Key: location,
				Body: file,
				ContentType: mimeType,
				CacheControl: options?.cacheControl,
				ContentDisposition: options?.contentDisposition,
				Metadata: options?.metadata,
				ACL: options?.visibility === "public" ? "public-read" : void 0
			});
			const result = await this.client.send(command);
			return {
				path: location,
				url: this.url(location),
				size: file.length,
				hash,
				mimeType,
				driver: this.name,
				bucket: this.options.bucket,
				region: this.options.region,
				etag: result.ETag,
				versionId: result.VersionId
			};
		}, "put");
	}
	/**
	* Put file from a readable stream (for large files)
	* Uses S3 multipart upload for efficient streaming
	*/
	async putStream(stream, location, options) {
		return this.withRetry(async () => {
			const { Upload } = S3Storage;
			location = this.applyPrefix(location);
			const mimeType = options?.mimeType || this.guessMimeType(location);
			const result = await new Upload({
				client: this.client,
				params: {
					Bucket: this.options.bucket,
					Key: location,
					Body: stream,
					ContentType: mimeType,
					CacheControl: options?.cacheControl,
					ContentDisposition: options?.contentDisposition,
					Metadata: options?.metadata,
					ACL: options?.visibility === "public" ? "public-read" : void 0
				}
			}).done();
			const info = await this.metadata(location);
			return {
				path: location,
				url: this.url(location),
				size: info.size,
				hash: info.etag?.replace(/"/g, "") || "",
				mimeType,
				driver: this.name,
				bucket: this.options.bucket,
				region: this.options.region,
				etag: result.ETag,
				versionId: result.VersionId
			};
		}, "putStream");
	}
	/**
	* Get file contents as Buffer
	*/
	async get(location) {
		return this.withRetry(async () => {
			const { GetObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new GetObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			const result = await this.client.send(command);
			if (!result.Body) throw new Error(`File not found: ${location}`);
			return Buffer.from(await result.Body.transformToByteArray());
		}, "get");
	}
	/**
	* Get file as a readable stream (for large files)
	*/
	async getStream(location) {
		return this.withRetry(async () => {
			const { GetObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new GetObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			const result = await this.client.send(command);
			if (!result.Body) throw new Error(`File not found: ${location}`);
			return result.Body;
		}, "getStream");
	}
	/**
	* Delete a file
	*/
	async delete(location) {
		return this.withRetry(async () => {
			const { DeleteObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new DeleteObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			await this.client.send(command);
			return true;
		}, "delete");
	}
	/**
	* Delete multiple files at once (uses batch delete for efficiency)
	*/
	async deleteMany(locations) {
		if (locations.length === 0) return [];
		return this.withRetry(async () => {
			const { DeleteObjectsCommand } = S3Client;
			const prefixedLocations = locations.map((loc) => this.applyPrefix(loc));
			const command = new DeleteObjectsCommand({
				Bucket: this.options.bucket,
				Delete: {
					Objects: prefixedLocations.map((Key) => ({ Key })),
					Quiet: false
				}
			});
			const result = await this.client.send(command);
			const results = [];
			for (const deleted of result.Deleted || []) if (deleted.Key) results.push({
				location: deleted.Key,
				deleted: true
			});
			for (const error of result.Errors || []) if (error.Key) results.push({
				location: error.Key,
				deleted: false,
				error: error.Message || "Unknown error"
			});
			return results;
		}, "deleteMany");
	}
	/**
	* Delete directory (recursively deletes all objects with matching prefix)
	*
	* S3/R2 doesn't have true directories - only key prefixes.
	* This method lists all objects with the prefix and deletes them in batches.
	*
	* @param directoryPath - Directory prefix to delete
	* @returns true when all objects are deleted
	*/
	async deleteDirectory(directoryPath) {
		directoryPath = this.applyPrefix(directoryPath);
		const prefix = directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;
		let hasMore = true;
		while (hasMore) {
			const objects = await this.list(prefix, {
				limit: 1e3,
				recursive: true
			});
			if (objects.length === 0) break;
			const filePaths = objects.filter((obj) => !obj.isDirectory).map((obj) => obj.path);
			if (filePaths.length === 0) break;
			await this.deleteMany(filePaths);
			hasMore = objects.length >= 1e3;
		}
		return true;
	}
	/**
	* Check if file exists
	*/
	async exists(location) {
		try {
			const { HeadObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new HeadObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			await this.client.send(command);
			return true;
		} catch {
			return false;
		}
	}
	/**
	* Get a temporary presigned URL (alias for getPresignedUrl)
	*/
	async temporaryUrl(location, expiresIn = 3600) {
		return this.getPresignedUrl(location, { expiresIn });
	}
	/**
	* Get presigned URL for downloading
	*/
	async getPresignedUrl(location, options) {
		return this.withRetry(async () => {
			const { GetObjectCommand } = S3Client;
			const { getSignedUrl } = S3Presigner;
			location = this.applyPrefix(location);
			const command = new GetObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			return getSignedUrl(this.client, command, { expiresIn: options?.expiresIn || 3600 });
		}, "getPresignedUrl");
	}
	/**
	* Get presigned URL for uploading
	*/
	async getPresignedUploadUrl(location, options) {
		return this.withRetry(async () => {
			const { PutObjectCommand } = S3Client;
			const { getSignedUrl } = S3Presigner;
			location = this.applyPrefix(location);
			const command = new PutObjectCommand({
				Bucket: this.options.bucket,
				Key: location,
				ContentType: options?.contentType,
				Metadata: options?.metadata
			});
			return getSignedUrl(this.client, command, { expiresIn: options?.expiresIn || 3600 });
		}, "getPresignedUploadUrl");
	}
	/**
	* Get file info/metadata without downloading
	*/
	async metadata(location) {
		return this.withRetry(async () => {
			const { HeadObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new HeadObjectCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			const result = await this.client.send(command);
			const name = location.split("/").pop() || "";
			return {
				path: location,
				name,
				size: result.ContentLength || 0,
				isDirectory: false,
				lastModified: result.LastModified,
				mimeType: result.ContentType || this.guessMimeType(location),
				etag: result.ETag,
				storageClass: result.StorageClass
			};
		}, "metadata");
	}
	/**
	* Get file size in bytes (shortcut for metadata().size)
	*/
	async size(location) {
		return (await this.metadata(location)).size;
	}
	/**
	* Copy file to a new location
	*/
	async copy(from, to) {
		return this.withRetry(async () => {
			const { CopyObjectCommand, HeadObjectCommand } = S3Client;
			from = this.applyPrefix(from);
			to = this.applyPrefix(to);
			const command = new CopyObjectCommand({
				Bucket: this.options.bucket,
				CopySource: `${this.options.bucket}/${from}`,
				Key: to
			});
			const result = await this.client.send(command);
			const headCommand = new HeadObjectCommand({
				Bucket: this.options.bucket,
				Key: to
			});
			const headResult = await this.client.send(headCommand);
			return {
				path: to,
				url: this.url(to),
				size: headResult.ContentLength || 0,
				hash: headResult.ETag?.replace(/"/g, "") || "",
				mimeType: headResult.ContentType || this.guessMimeType(to),
				driver: this.name,
				bucket: this.options.bucket,
				region: this.options.region,
				etag: result.CopyObjectResult?.ETag,
				versionId: result.VersionId
			};
		}, "copy");
	}
	/**
	* Move file to a new location
	*/
	async move(from, to) {
		const file = await this.copy(from, to);
		await this.delete(from);
		return file;
	}
	/**
	* List files in a directory
	*/
	async list(directory, options) {
		return this.withRetry(async () => {
			const { ListObjectsV2Command } = S3Client;
			directory = this.applyPrefix(directory);
			const command = new ListObjectsV2Command({
				Bucket: this.options.bucket,
				Prefix: directory,
				MaxKeys: options?.limit,
				ContinuationToken: options?.cursor,
				Delimiter: options?.recursive ? void 0 : "/"
			});
			const result = await this.client.send(command);
			const files = [];
			for (const object of result.Contents || []) {
				if (!object.Key) continue;
				files.push({
					path: object.Key,
					name: object.Key.split("/").pop() || "",
					size: object.Size || 0,
					isDirectory: false,
					lastModified: object.LastModified,
					etag: object.ETag,
					storageClass: object.StorageClass
				});
			}
			for (const prefix of result.CommonPrefixes || []) {
				if (!prefix.Prefix) continue;
				files.push({
					path: prefix.Prefix,
					name: prefix.Prefix.split("/").filter(Boolean).pop() || "",
					size: 0,
					isDirectory: true
				});
			}
			return files;
		}, "list");
	}
	/**
	* Get bucket name
	*/
	getBucket() {
		return this.options.bucket;
	}
	/**
	* Get region
	*/
	getRegion() {
		return this.options.region;
	}
	/**
	* Set storage class (e.g., STANDARD, GLACIER, etc.)
	*/
	async setStorageClass(location, storageClass) {
		return this.withRetry(async () => {
			const { CopyObjectCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new CopyObjectCommand({
				Bucket: this.options.bucket,
				CopySource: `${this.options.bucket}/${location}`,
				Key: location,
				StorageClass: storageClass,
				MetadataDirective: "COPY"
			});
			await this.client.send(command);
		}, "setStorageClass");
	}
	/**
	* Set file visibility (public or private)
	*/
	async setVisibility(location, visibility) {
		return this.withRetry(async () => {
			const { PutObjectAclCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new PutObjectAclCommand({
				Bucket: this.options.bucket,
				Key: location,
				ACL: visibility === "public" ? "public-read" : "private"
			});
			await this.client.send(command);
		}, "setVisibility");
	}
	/**
	* Get file visibility
	*/
	async getVisibility(location) {
		return this.withRetry(async () => {
			const { GetObjectAclCommand } = S3Client;
			location = this.applyPrefix(location);
			const command = new GetObjectAclCommand({
				Bucket: this.options.bucket,
				Key: location
			});
			return (await this.client.send(command)).Grants?.some((grant) => grant.Grantee?.URI === "http://acs.amazonaws.com/groups/global/AllUsers" && grant.Permission === "READ") ? "public" : "private";
		}, "getVisibility");
	}
	/**
	* Calculate SHA-256 hash
	*/
	calculateHash(buffer) {
		return crypto.createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
	}
	/**
	* Guess MIME type from file extension
	*/
	guessMimeType(location) {
		return getMimeType(location);
	}
};
//#endregion
export { CloudDriver, loadS3 };

//# sourceMappingURL=cloud-driver.mjs.map