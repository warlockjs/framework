import { StorageFile } from "./storage-file.mjs";
import { CloudStorageDriverContract, CloudStorageDriverOptions, DeleteManyResult, FileVisibility, ListOptions, LocalStorageDriverOptions, PresignedOptions, PresignedUploadOptions, PutOptions, R2StorageDriverOptions, ScopedStorageContract, StorageDriverConfig, StorageDriverContract, StorageDriverName, StorageEventHandler, StorageEventPayload, StorageEventType, StorageFileInfo, StorageManagerContract, TemporaryTokenValidation } from "./types.mjs";
import { ScopedStorage } from "./scoped-storage.mjs";
import { UploadedFile } from "../http/uploaded-file.mjs";
import { EventSubscription } from "@mongez/events";
import { Readable } from "stream";

//#region ../../@warlock.js/core/src/storage/storage.d.ts
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
declare class Storage extends ScopedStorage implements StorageManagerContract {
  /**
   * Registered drivers (cached instances)
   * @internal
   */
  protected drivers: Map<string, StorageDriverContract>;
  /**
   * Driver configurations
   * @internal
   */
  protected configs: Map<string, StorageDriverConfig>;
  /**
   * Default driver name
   * @internal
   */
  protected defaultDriverName: StorageDriverName;
  /**
   * Whether the storage has been initialized
   * @internal
   */
  private initialized;
  /**
   * Create a new Storage manager instance
   *
   * Uses lazy initialization - driver is resolved on first access.
   */
  constructor();
  /**
   * Ensure storage is initialized (lazy initialization)
   *
   * Called automatically on first driver access.
   */
  init(): Promise<void>;
  /**
   * Reset storage defaults
   */
  reset(): void;
  /**
   * Get the currently active driver (context-aware in future)
   *
   * Currently returns the default driver.
   * Will be enhanced to check AsyncLocalStorage context for multi-tenant support.
   *
   * @returns The active storage driver
   */
  get activeDriver(): StorageDriverContract;
  /**
   * Load drivers from configuration
   * @internal
   */
  protected loadDriversFromConfig(): void;
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
  use(name: StorageDriverName): ScopedStorageContract;
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
  getDriver(name: StorageDriverName): StorageDriverContract;
  /**
   * Get root directory of current driver
   */
  root(apepndedPath?: string): string;
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
  useCloud(name: StorageDriverName): CloudStorageDriverContract;
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
  register(name: StorageDriverName, config: StorageDriverConfig): this;
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
  setDefault(name: StorageDriverName): this;
  /**
   * Check if current driver is a cloud driver
   *
   * @returns Promise resolving to true if the current driver supports cloud operations
   */
  isCloud(): Promise<boolean>;
  /**
   * Check if a driver instance supports cloud operations
   * @internal
   */
  protected isCloudDriver(driver: StorageDriverContract): driver is CloudStorageDriverContract;
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
  on<T extends StorageEventPayload = StorageEventPayload>(event: StorageEventType, handler: StorageEventHandler<T>): EventSubscription;
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
  off(event: StorageEventType): this;
  /**
   * Emit an event to all registered handlers
   * @internal
   */
  protected emit<T extends StorageEventPayload>(event: StorageEventType, payload: T): Promise<void>;
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
  put(file: UploadedFile | Buffer | string | Readable, location: string, options?: PutOptions): Promise<StorageFile>;
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
  putStream(stream: Readable | string, location: string, options?: PutOptions): Promise<StorageFile>;
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
  putFromUrl(url: string, location: string, options?: PutOptions): Promise<StorageFile>;
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
  putFromBase64(base64: string, location: string, options?: PutOptions): Promise<StorageFile>;
  /**
   * Retrieve file contents as Buffer
   *
   * Uses the current driver (with async resolution).
   *
   * @param location - File path
   * @returns Buffer containing file contents
   */
  get(location: string): Promise<Buffer>;
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
  getJson(location: string): Promise<any>;
  /**
   * Retrieve a file as a readable stream (for large files)
   *
   * @param location - File path
   * @returns Readable stream of file contents
   */
  getStream(location: string): Promise<Readable>;
  /**
   * Delete a file
   *
   * Extends base `delete()` with event emission.
   *
   * @param location - File path or StorageFile
   * @returns true if deleted, false if not found
   */
  delete(location: string | StorageFile): Promise<boolean>;
  /**
   * Delete multiple files at once
   *
   * @param locations - Array of file paths
   * @returns Array of delete results with status for each file
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;
  /**
   * Check if a file exists
   *
   * @param location - File path
   * @returns true if file exists
   */
  exists(location: string): Promise<boolean>;
  /**
   * Copy a file to a new location
   *
   * Extends base `copy()` with event emission.
   *
   * @param from - Source path or StorageFile
   * @param to - Destination path
   * @returns StorageFile instance at destination
   */
  copy(from: string | StorageFile, to: string): Promise<StorageFile>;
  /**
   * Move a file to a new location
   *
   * Extends base `move()` with event emission.
   *
   * @param from - Source path or StorageFile
   * @param to - Destination path
   * @returns StorageFile instance at destination
   */
  move(from: string | StorageFile, to: string): Promise<StorageFile>;
  /**
   * List files in a directory
   *
   * @param directory - Directory path (defaults to root)
   * @param options - List options (recursive, limit, etc.)
   * @returns Array of file information objects
   */
  list(directory?: string, options?: ListOptions): Promise<StorageFileInfo[]>;
  /**
   * Get file metadata without downloading
   *
   * @param location - File path
   * @returns File information object
   */
  metadata(location: string): Promise<StorageFileInfo>;
  /**
   * Get file size in bytes
   *
   * @param location - File path
   * @returns File size in bytes
   */
  size(location: string): Promise<number>;
  /**
   * Get the absolute filesystem path for a location
   *
   * Only available for local driver.
   *
   * @param location - File path
   * @throws Error if current driver is not a local driver
   * @returns Absolute filesystem path
   */
  path(location: string): Promise<string>;
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
  getPresignedUrl(location: string, options?: PresignedOptions): Promise<string>;
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
  getPresignedUploadUrl(location: string, options?: PresignedUploadOptions): Promise<string>;
  /**
   * Get the bucket name for cloud storage
   *
   * Only available for cloud drivers.
   *
   * @throws Error if current driver is not a cloud driver
   * @returns Bucket name
   */
  getBucket(): Promise<string>;
  /**
   * Get the region for cloud storage
   *
   * Only available for cloud drivers.
   *
   * @throws Error if current driver is not a cloud driver
   * @returns Region name
   */
  getRegion(): Promise<string>;
  /**
   * Set storage class for a file (e.g., STANDARD, GLACIER, etc.)
   *
   * Only available for cloud drivers.
   *
   * @param location - File path
   * @param storageClass - Target storage class
   * @throws Error if current driver is not a cloud driver
   */
  setStorageClass(location: string, storageClass: string): Promise<void>;
  /**
   * Set file visibility (public or private)
   *
   * Only available for cloud drivers.
   *
   * @param location - File path
   * @param visibility - "public" or "private"
   * @throws Error if current driver is not a cloud driver
   */
  setVisibility(location: string, visibility: FileVisibility): Promise<void>;
  /**
   * Get file visibility
   *
   * Only available for cloud drivers.
   *
   * @param location - File path
   * @throws Error if current driver is not a cloud driver
   * @returns Current visibility setting
   */
  getVisibility(location: string): Promise<FileVisibility>;
  /**
   * Get a temporary signed URL
   *
   * Creates a URL that provides temporary access to the file.
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration (default: 3600)
   * @returns Signed URL string
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;
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
  validateTemporaryToken(token: string): Promise<TemporaryTokenValidation>;
  /**
   * Parse config into driver-specific options
   * @internal
   */
  protected parseOptions(config: StorageDriverConfig): LocalStorageDriverOptions | CloudStorageDriverOptions | R2StorageDriverOptions;
  /**
   * Validate cloud driver configuration has required fields
   * @internal
   */
  protected validateCloudConfig(config: StorageDriverConfig, driverName: string): void;
  /**
   * Get or create driver instance from cache
   * @internal
   */
  protected resolveDriver(name: string): StorageDriverContract;
  /**
   * Resolve the default driver name (supports async resolver for multi-tenancy)
   * @internal
   */
  protected resolveDefaultDriver(): Promise<StorageDriverName>;
}
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
declare const storage: Storage;
//#endregion
export { Storage, storage };
//# sourceMappingURL=storage.d.mts.map