import { CloudStorageDriverContract, CloudStorageDriverOptions, CloudStorageFileData, DeleteManyResult, FileVisibility, ListOptions, PresignedOptions, PresignedUploadOptions, PutOptions, StorageDriverType, StorageFileInfo } from "../types.mjs";
import { Readable } from "stream";

//#region ../../@warlock.js/core/src/storage/drivers/cloud-driver.d.ts
/**
 * Load S3 modules lazily
 *
 * @example
 * await loadS3();
 * if (isModuleExists) {
 *   // Safe to use S3Client, S3Storage, S3Presigner
 * }
 */
declare function loadS3(): Promise<void>;
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
declare abstract class CloudDriver<TOptions extends Partial<CloudStorageDriverOptions> = CloudStorageDriverOptions> implements CloudStorageDriverContract {
  options: TOptions;
  /**
   * S3-compatible client (lazy-loaded)
   */
  protected client: InstanceType<typeof import("@aws-sdk/client-s3").S3Client>;
  /**
   * Retry configuration
   */
  protected retryConfig: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
  constructor(options: TOptions);
  /**
   * Driver name identifier
   */
  abstract readonly name: StorageDriverType;
  /**
   * Get public URL for file
   * Must be implemented by subclasses with provider-specific format
   */
  abstract url(location: string): string;
  /**
   * Get endpoint URL
   * Can be overridden by subclasses for provider-specific endpoints
   */
  protected getEndpoint(): string | undefined;
  /**
   * Apply prefix to location path
   *
   * Priority: context prefix > driver options prefix > no prefix
   * This allows multi-tenant scenarios where context overrides driver config.
   *
   * @param location - Original location path
   * @returns Location with prefix applied if one exists
   */
  applyPrefix(location: string): string;
  /**
   * Normalize storage path (remove double slashes, sanitize)
   * @internal
   */
  protected normalizePath(path: string): string;
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
  protected withRetry<T>(operation: () => Promise<T>, operationName?: string): Promise<T>;
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
  protected isRetryableError(error: any): boolean;
  /**
   * Put file to cloud storage
   */
  put(file: Buffer, location: string, options?: PutOptions): Promise<CloudStorageFileData>;
  /**
   * Put file from a readable stream (for large files)
   * Uses S3 multipart upload for efficient streaming
   */
  putStream(stream: Readable, location: string, options?: PutOptions): Promise<CloudStorageFileData>;
  /**
   * Get file contents as Buffer
   */
  get(location: string): Promise<Buffer>;
  /**
   * Get file as a readable stream (for large files)
   */
  getStream(location: string): Promise<Readable>;
  /**
   * Delete a file
   */
  delete(location: string): Promise<boolean>;
  /**
   * Delete multiple files at once (uses batch delete for efficiency)
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;
  /**
   * Delete directory (recursively deletes all objects with matching prefix)
   *
   * S3/R2 doesn't have true directories - only key prefixes.
   * This method lists all objects with the prefix and deletes them in batches.
   *
   * @param directoryPath - Directory prefix to delete
   * @returns true when all objects are deleted
   */
  deleteDirectory(directoryPath: string): Promise<boolean>;
  /**
   * Check if file exists
   */
  exists(location: string): Promise<boolean>;
  /**
   * Get a temporary presigned URL (alias for getPresignedUrl)
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;
  /**
   * Get presigned URL for downloading
   */
  getPresignedUrl(location: string, options?: PresignedOptions): Promise<string>;
  /**
   * Get presigned URL for uploading
   */
  getPresignedUploadUrl(location: string, options?: PresignedUploadOptions): Promise<string>;
  /**
   * Get file info/metadata without downloading
   */
  metadata(location: string): Promise<StorageFileInfo>;
  /**
   * Get file size in bytes (shortcut for metadata().size)
   */
  size(location: string): Promise<number>;
  /**
   * Copy file to a new location
   */
  copy(from: string, to: string): Promise<CloudStorageFileData>;
  /**
   * Move file to a new location
   */
  move(from: string, to: string): Promise<CloudStorageFileData>;
  /**
   * List files in a directory
   */
  list(directory: string, options?: ListOptions): Promise<StorageFileInfo[]>;
  /**
   * Get bucket name
   */
  getBucket(): string;
  /**
   * Get region
   */
  getRegion(): string;
  /**
   * Set storage class (e.g., STANDARD, GLACIER, etc.)
   */
  setStorageClass(location: string, storageClass: string): Promise<void>;
  /**
   * Set file visibility (public or private)
   */
  setVisibility(location: string, visibility: FileVisibility): Promise<void>;
  /**
   * Get file visibility
   */
  getVisibility(location: string): Promise<FileVisibility>;
  /**
   * Calculate SHA-256 hash
   */
  protected calculateHash(buffer: Buffer): string;
  /**
   * Guess MIME type from file extension
   */
  protected guessMimeType(location: string): string;
}
//#endregion
export { CloudDriver, loadS3 };
//# sourceMappingURL=cloud-driver.d.mts.map