import type { Readable } from "stream";
import type { UploadedFile } from "../http";
import type { StorageFile } from "./storage-file";

// === LOCAL DRIVER OPTIONS ===

/**
 * Options for local storage driver
 */
export type LocalStorageDriverOptions = {
  /**
   * Root path for storage
   * Defaults to storagePath() utility
   */
  root?: string;
  /**
   * URL prefix for file URLs
   * @default "/uploads"
   */
  urlPrefix?: string;
  /**
   * URL prefix for temporary file URLs
   * The token will be appended: {temporaryUrlPrefix}/{token}
   * @default "/temp-files"
   */
  temporaryUrlPrefix?: string;
  /**
   * Secret key for signing temporary URLs
   * Required for temporaryUrl() support
   */
  signatureKey?: string;
};

// === CLOUD DRIVER OPTIONS ===

/**
 * Base options for all S3-compatible cloud storage drivers
 */
export type CloudStorageDriverOptions = {
  /**
   * Bucket name
   */
  bucket: string;
  /**
   * Region (e.g., "us-east-1" for S3, "auto" for R2, "nyc3" for DO Spaces)
   */
  region: string;
  /**
   * Access key ID
   */
  accessKeyId: string;
  /**
   * Secret access key
   */
  secretAccessKey: string;
  /**
   * Custom endpoint URL
   * Optional - derived from provider if not specified
   */
  endpoint?: string;
  /**
   * Custom URL prefix for public URLs (e.g., CDN domain)
   */
  urlPrefix?: string;
};

/**
 * Options specific to Cloudflare R2 driver
 */
export type R2StorageDriverOptions = CloudStorageDriverOptions & {
  /**
   * Cloudflare account ID
   */
  accountId: string;
  /**
   * Custom public domain for R2 bucket
   * If using Cloudflare CDN with custom domain
   */
  publicDomain?: string;
};

// === DATA TYPES ===

/**
 * Base storage file data returned from operations
 */
export type StorageFileData = {
  path: string;
  url: string;
  size: number;
  hash: string;
  mimeType: string;
  driver: string;
};

/**
 * Extended storage file data with cloud-specific metadata
 */
export type CloudStorageFileData = StorageFileData & {
  bucket: string;
  region: string;
  etag?: string;
  versionId?: string;
  storageClass?: string;
  lastModified?: Date;
  contentEncoding?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

/**
 * Storage file info for list and getInfo operations
 */
export type StorageFileInfo = {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  lastModified?: Date;
  mimeType?: string;
  etag?: string;
  storageClass?: string;
};

/**
 * Options for list operations
 */
export type ListOptions = {
  recursive?: boolean;
  limit?: number;
  prefix?: string;
  cursor?: string;
};

/**
 * Options for presigned URLs
 */
export type PresignedOptions = {
  expiresIn?: number;
};

/**
 * Options for presigned upload URLs
 */
export type PresignedUploadOptions = PresignedOptions & {
  contentType?: string;
  maxSize?: number;
  metadata?: Record<string, string>;
};

/**
 * Options for put operations
 */
export type PutOptions = {
  /**
   * Explicit MIME type for the file
   * If not provided, will be guessed from file extension
   */
  mimeType?: string;
  /**
   * Custom metadata to store with the file (cloud drivers only)
   */
  metadata?: Record<string, string>;
  /**
   * Cache-Control header (cloud drivers only)
   */
  cacheControl?: string;
  /**
   * Content-Disposition header (cloud drivers only)
   */
  contentDisposition?: string;
  /**
   * File visibility (cloud drivers only)
   */
  visibility?: FileVisibility;
};

// === TEMPORARY TOKENS ===

/**
 * Payload encoded in temporary URL tokens
 */
export type TemporaryTokenPayload = {
  /**
   * Relative file path
   */
  path: string;
  /**
   * Expiration timestamp (Unix seconds)
   */
  exp: number;
  /**
   * HMAC signature
   */
  sig: string;
};

/**
 * Validation error types
 */
export type TemporaryTokenError =
  | "expired"
  | "invalid_signature"
  | "invalid_token"
  | "missing_key"
  | "file_not_found";

/**
 * Result of validating a temporary URL token
 */
export type TemporaryTokenValidation = {
  /**
   * Whether the token is valid
   */
  valid: boolean;
  /**
   * Error reason if invalid
   */
  error?: TemporaryTokenError;
  /**
   * Relative file path (available when valid)
   */
  path?: string;
  /**
   * Absolute filesystem path (local driver only, for sendFile)
   */
  absolutePath?: string;
  /**
   * Token expiration date
   */
  expiresAt?: Date;
  /**
   * MIME type of the file
   */
  mimeType?: string;
  /**
   * The driver instance that created this token
   */
  driver?: StorageDriverContract;
  /**
   * Get file contents as Buffer
   */
  getFile?: () => Promise<Buffer>;
  /**
   * Get file as readable stream
   */
  getStream?: () => Promise<Readable>;
};

// === VISIBILITY ===

/**
 * File visibility options
 */
export type FileVisibility = "public" | "private";

// === EVENTS ===

/**
 * Storage event types
 */
export type StorageEventType =
  | "beforePut"
  | "afterPut"
  | "beforeDelete"
  | "afterDelete"
  | "beforeCopy"
  | "afterCopy"
  | "beforeMove"
  | "afterMove";

/**
 * Storage event payload base
 */
export type StorageEventPayload = {
  driver: string;
  location: string;
  timestamp: Date;
};

/**
 * Put event payload
 */
export type StoragePutEventPayload = StorageEventPayload & {
  file?: StorageFileData;
  size?: number;
  mimeType?: string;
};

/**
 * Copy/Move event payload
 */
export type StorageCopyEventPayload = StorageEventPayload & {
  from: string;
  to: string;
  file?: StorageFileData;
};

/**
 * Storage event handler type
 */
export type StorageEventHandler<T extends StorageEventPayload = StorageEventPayload> = (
  payload: T,
) => void | Promise<void>;

// === DELETE RESULT ===

/**
 * Result of a batch delete operation
 */
export type DeleteManyResult = {
  location: string;
  deleted: boolean;
  error?: string;
};

// === CONFIGURATION ===

export type StorageDriverType = "local" | "s3" | "r2" | "spaces";

/**
 * Storage driver configuration
 * Used in configuration files
 */
export type StorageDriverConfig = {
  /**
   * Driver type
   */
  driver: StorageDriverType;

  // === Local driver options ===

  /**
   * Root path for local storage
   */
  root?: string;

  /**
   * Secret key for signing local temporary URLs
   */
  signatureKey?: string;

  // === Cloud driver options ===

  /**
   * Bucket name (required for cloud drivers)
   */
  bucket?: string;
  /**
   * Region (required for cloud drivers)
   */
  region?: string;
  /**
   * Access key ID (required for cloud drivers)
   */
  accessKeyId?: string;
  /**
   * Secret access key (required for cloud drivers)
   */
  secretAccessKey?: string;
  /**
   * Custom endpoint URL
   */
  endpoint?: string;
  /**
   * URL prefix for public URLs
   */
  urlPrefix?: string;

  // === R2 specific options ===

  /**
   * Cloudflare account ID (required for R2)
   */
  accountId?: string;
  /**
   * Custom public domain for R2
   */
  publicDomain?: string;
};

/**
 * Storage driver registry interface.
 *
 * This interface is extended via module augmentation by generated typings.
 * Each key represents a configured storage driver name.
 *
 * @example Generated augmentation:
 * ```typescript
 * declare module "@warlock.js/core" {
 *   interface StorageDriverRegistry {
 *     disk: true;
 *     aws: true;
 *   }
 * }
 * ```
 */
export interface StorageDriverRegistry {}

/**
 * Storage driver name type.
 *
 * Extracts driver names from the registry interface.
 * Falls back to `string` if no drivers are registered.
 * Autocomplete provided by generated `.warlock/typings/storage.d.ts`
 */
export type StorageDriverName = keyof StorageDriverRegistry extends never
  ? string
  : keyof StorageDriverRegistry;

/**
 * Storage configurations
 */
export type StorageConfigurations = {
  /**
   * Default driver name
   */
  default: StorageDriverName;
  /**
   * Driver configurations
   */
  drivers: Record<StorageDriverName, StorageDriverConfig>;
  /**
   * Optional resolver for dynamic driver selection (e.g., multi-tenancy)
   */
  resolver?: () => Promise<StorageDriverName> | StorageDriverName;
};

// === CONTRACTS ===

/**
 * Base storage driver contract
 *
 * Defines the core operations that all storage drivers must implement.
 * Drivers return raw data objects (`StorageFileData`), while the
 * `ScopedStorage` and `Storage` classes wrap these in `StorageFile` instances.
 */
export interface StorageDriverContract {
  /**
   * Driver name identifier (e.g., "local", "s3", "r2", "spaces")
   */
  readonly name: StorageDriverType;

  // ==== Core Operations ====

  /**
   * Store a file in storage
   *
   * @param file - File content as Buffer, UploadedFile, string content, or Readable stream
   * @param location - Destination path in storage
   * @param options - Optional storage options (mimeType, cacheControl, etc.)
   * @returns Raw file data object
   */
  put(
    file: Buffer | UploadedFile | string | Readable,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFileData>;

  /**
   * Store a file from a readable stream
   *
   * Optimized for large files - streams directly without full buffering.
   *
   * @param stream - Readable stream of file content
   * @param location - Destination path in storage
   * @param options - Optional storage options
   * @returns Raw file data object
   */
  putStream(stream: Readable, location: string, options?: PutOptions): Promise<StorageFileData>;

  /**
   * Retrieve file contents as Buffer
   *
   * @param location - Path to the file
   * @returns Buffer containing file contents
   * @throws Error if file not found
   */
  get(location: string): Promise<Buffer>;

  /**
   * Retrieve file contents as a readable stream
   *
   * @param location - Path to the file
   * @returns Readable stream of file contents
   * @throws Error if file not found
   */
  getStream(location: string): Promise<Readable>;

  /**
   * Delete a file
   *
   * @param location - Path to the file
   * @returns `true` if deleted, `false` if not found
   */
  delete(location: string): Promise<boolean>;

  /**
   * Delete multiple files at once
   *
   * @param locations - Array of file paths to delete
   * @returns Array of results with status for each file
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;

  /**
   * Check if a file exists
   *
   * @param location - Path to check
   * @returns `true` if exists, `false` otherwise
   */
  exists(location: string): Promise<boolean>;

  // ==== URL Operations ====

  /**
   * Get the public URL for a file
   *
   * @param location - File path
   * @returns Public URL string
   */
  url(location: string): string;

  /**
   * Get a temporary signed URL with expiration
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration (default: 3600)
   * @returns Signed URL string
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;

  // ==== Metadata Operations ====

  /**
   * Get file metadata without downloading
   *
   * @param location - File path
   * @returns File information object
   * @throws Error if file not found
   */
  getInfo(location: string): Promise<StorageFileInfo>;

  /**
   * Get file size in bytes
   *
   * @param location - File path
   * @returns File size in bytes
   * @throws Error if file not found
   */
  size(location: string): Promise<number>;

  // ==== File Operations ====

  /**
   * Copy a file to a new location
   *
   * @param from - Source path
   * @param to - Destination path
   * @returns Raw file data object for the copy
   */
  copy(from: string, to: string): Promise<StorageFileData>;

  /**
   * Move a file to a new location
   *
   * @param from - Source path
   * @param to - Destination path
   * @returns Raw file data object at new location
   */
  move(from: string, to: string): Promise<StorageFileData>;

  /**
   * List files in a directory
   *
   * @param directory - Directory path
   * @param options - List options (recursive, limit, cursor)
   * @returns Array of file information objects
   */
  list(directory: string, options?: ListOptions): Promise<StorageFileInfo[]>;

  // ==== Path Operations (local driver) ====

  /**
   * Get the absolute filesystem path for a location
   * Only available for local storage drivers.
   *
   * @param location - File path
   * @returns Absolute filesystem path
   */
  path?(location: string): string;
}

/**
 * Cloud storage driver contract with extended methods
 *
 * Extends the base contract with cloud-specific functionality
 * like presigned URLs, visibility control, and storage classes.
 */
export interface CloudStorageDriverContract extends StorageDriverContract {
  /**
   * Store a file (returns cloud-specific data)
   */
  put(file: Buffer, location: string, options?: PutOptions): Promise<CloudStorageFileData>;

  /**
   * Store a file from stream (returns cloud-specific data)
   */
  putStream(
    stream: Readable,
    location: string,
    options?: PutOptions,
  ): Promise<CloudStorageFileData>;

  /**
   * Copy a file (returns cloud-specific data)
   */
  copy(from: string, to: string): Promise<CloudStorageFileData>;

  /**
   * Move a file (returns cloud-specific data)
   */
  move(from: string, to: string): Promise<CloudStorageFileData>;

  // ==== Presigned URLs ====

  /**
   * Get a presigned URL for downloading
   *
   * @param location - File path
   * @param options - Presigned URL options
   * @returns Presigned download URL
   */
  getPresignedUrl(location: string, options?: PresignedOptions): Promise<string>;

  /**
   * Get a presigned URL for uploading
   *
   * @param location - Destination path
   * @param options - Presigned upload options
   * @returns Presigned upload URL
   */
  getPresignedUploadUrl(location: string, options?: PresignedUploadOptions): Promise<string>;

  // ==== Cloud Metadata ====

  /**
   * Get the bucket name
   */
  getBucket(): string;

  /**
   * Get the region
   */
  getRegion(): string;

  /**
   * Set storage class (e.g., STANDARD, GLACIER, etc.)
   *
   * @param location - File path
   * @param storageClass - Target storage class
   */
  setStorageClass(location: string, storageClass: string): Promise<void>;

  // ==== Visibility ====

  /**
   * Set file visibility
   *
   * @param location - File path
   * @param visibility - "public" or "private"
   */
  setVisibility(location: string, visibility: FileVisibility): Promise<void>;

  /**
   * Get file visibility
   *
   * @param location - File path
   * @returns Current visibility setting
   */
  getVisibility(location: string): Promise<FileVisibility>;
}

/**
 * Scoped storage contract
 *
 * Contract for storage wrappers that return `StorageFile` instances
 * instead of raw `StorageFileData`. Used by `ScopedStorage` and `Storage`.
 *
 * This provides the developer-facing API with rich file objects.
 */
export interface ScopedStorageContract {
  /**
   * Driver name identifier
   */
  readonly name: string;

  /**
   * Store a file in storage
   *
   * @param file - File content
   * @param location - Destination path
   * @param options - Storage options
   * @returns StorageFile instance
   */
  put(
    file: Buffer | UploadedFile | string | Readable,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFile>;

  /**
   * Store a file from stream
   */
  putStream(stream: Readable, location: string, options?: PutOptions): Promise<StorageFile>;

  /**
   * Get file contents
   */
  get(location: string): Promise<Buffer>;

  /**
   * Get file as stream
   */
  getStream(location: string): Promise<Readable>;

  /**
   * Delete a file
   */
  delete(location: string | StorageFile): Promise<boolean>;

  /**
   * Delete multiple files
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;

  /**
   * Check if file exists
   */
  exists(location: string): Promise<boolean>;

  /**
   * Get public URL
   */
  url(location: string): string;

  /**
   * Get temporary signed URL
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;

  /**
   * Get file metadata
   */
  getInfo(location: string): Promise<StorageFileInfo>;

  /**
   * Get file size
   */
  size(location: string): Promise<number>;

  /**
   * Copy a file
   */
  copy(from: string | StorageFile, to: string): Promise<StorageFile>;

  /**
   * Move a file
   */
  move(from: string | StorageFile, to: string): Promise<StorageFile>;

  /**
   * List files in directory
   */
  list(directory?: string, options?: ListOptions): Promise<StorageFileInfo[]>;

  /**
   * Get a StorageFile instance
   */
  file(location: string): Promise<StorageFile>;
}

/**
 * Storage manager contract
 *
 * Extends `ScopedStorageContract` with manager-specific functionality
 * like driver management, events, and configuration.
 *
 * This is the contract implemented by the `Storage` class.
 */
export interface StorageManagerContract extends ScopedStorageContract {
  // ==== Driver Management ====

  /**
   * Get a scoped storage for a specific driver
   *
   * Returns a `ScopedStorage` instance that wraps the specified driver
   * and provides the same DX (returns `StorageFile` instances).
   *
   * @param name - Driver name as configured
   * @returns ScopedStorage instance for the driver
   */
  use(name: StorageDriverName): ScopedStorageContract;

  /**
   * Get a raw driver instance
   *
   * Returns the underlying driver directly for advanced use cases.
   * Unlike `use()`, this returns raw `StorageFileData` instead of `StorageFile`.
   *
   * @param name - Driver name as configured
   * @returns Raw driver instance
   */
  getDriver(name: StorageDriverName): StorageDriverContract;

  /**
   * Register a new driver configuration at runtime
   *
   * @param name - Unique driver name
   * @param config - Driver configuration
   * @returns This instance for chaining
   */
  register(name: StorageDriverName, config: StorageDriverConfig): this;

  /**
   * Set the default driver name
   *
   * @param name - Driver name to use as default
   * @returns This instance for chaining
   */
  setDefault(name: StorageDriverName): this;

  // ==== Resolution ====

  /**
   * Get the current driver instance
   *
   * Resolves the driver based on configuration, including
   * any async resolver for multi-tenancy support.
   *
   * @returns Promise resolving to the current driver
   */
  currentDriver(): Promise<StorageDriverContract>;

  /**
   * Check if the current driver is a cloud driver
   *
   * @returns Promise resolving to true if cloud driver
   */
  isCloud(): Promise<boolean>;

  // ==== Events ====

  /**
   * Register an event handler
   *
   * @param event - Event type (beforePut, afterPut, etc.)
   * @param handler - Event handler function
   * @returns Event subscription for unsubscribing
   */
  on<T extends StorageEventPayload>(
    event: StorageEventType,
    handler: StorageEventHandler<T>,
  ): EventSubscription;

  /**
   * Remove all handlers for an event type
   *
   * @param event - Event type to remove handlers for
   * @returns This instance for chaining
   */
  off(event: StorageEventType): this;
}

/**
 * Event subscription returned by event handlers
 */
export interface EventSubscription {
  /**
   * Unsubscribe from the event
   */
  unsubscribe(): void;
}
