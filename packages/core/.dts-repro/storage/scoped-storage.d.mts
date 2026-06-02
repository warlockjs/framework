import { StorageFile } from "./storage-file.mjs";
import { DeleteManyResult, ListOptions, PutDirectoryOptions, PutDirectoryResult, PutOptions, ScopedStorageContract, StorageDriverContract, StorageDriverType, StorageFileInfo } from "./types.mjs";
import { UploadedFile } from "../http/uploaded-file.mjs";
import { Readable } from "stream";

//#region ../../@warlock.js/core/src/storage/scoped-storage.d.ts
/**
 * ScopedStorage - Base class for storage operations
 *
 * Wraps a storage driver and provides a consistent, developer-friendly API
 * that returns `StorageFile` instances instead of raw data objects.
 *
 * This class serves as the base for both direct driver usage and the
 * full `Storage` manager class.
 *
 * @example
 * ```typescript
 * // Using via storage.use()
 * const s3Storage = storage.use("s3");
 * const file = await s3Storage.put(buffer, "images/photo.jpg");
 *
 * // file is a StorageFile instance with rich API
 * console.log(file.name);       // "photo.jpg"
 * console.log(file.url);        // "https://..."
 * await file.copy("backup/photo.jpg");
 * ```
 */
declare class ScopedStorage implements ScopedStorageContract {
  /**
   * The underlying storage driver instance
   * @internal
   */
  protected _driver: StorageDriverContract;
  /**
   * Create a new ScopedStorage instance
   *
   * @param driver - The storage driver to wrap
   */
  constructor(driver: StorageDriverContract);
  /**
   * Get the driver name
   *
   * @returns The name identifier of the underlying driver (e.g., "local", "s3", "r2")
   */
  get name(): StorageDriverType;
  /**
   * Get the default driver instance
   *
   * Use this for advanced operations that require direct driver access.
   *
   * @returns The raw storage driver
   */
  get defaultDriver(): StorageDriverContract;
  /**
   * Get the currently active driver
   *
   * Returns the driver being used for storage operations.
   * Can be overridden in subclasses for dynamic driver resolution (e.g., multi-tenant contexts).
   *
   * @returns The active storage driver
   */
  get activeDriver(): StorageDriverContract;
  /**
   * Store a file in storage
   *
   * Accepts multiple input types and stores the file at the specified location.
   * Returns a `StorageFile` instance for further operations.
   *
   * @param file - File content as Buffer, string path, UploadedFile, or Readable stream
   * @param location - Destination path in storage (e.g., "uploads/images/photo.jpg")
   * @param options - Optional storage options
   * @returns StorageFile instance with cached metadata
   *
   * @example
   * ```typescript
   * // From buffer
   * const file = await storage.put(buffer, "documents/report.pdf");
   *
   * // From uploaded file
   * const file = await storage.put(uploadedFile, "avatars/user-123.jpg");
   *
   * // With options
   * const file = await storage.put(buffer, "images/photo.jpg", {
   *   mimeType: "image/jpeg",
   *   cacheControl: "max-age=31536000"
   * });
   * ```
   */
  put(file: UploadedFile | Buffer | string | Readable, location: string, options?: PutOptions): Promise<StorageFile>;
  /**
   * Store a file from a readable stream
   *
   * Optimized for large files - streams data directly without full buffering.
   * Ideal for file uploads, remote file fetching, or processing pipelines.
   *
   * @param stream - Readable stream of file content
   * @param location - Destination path in storage
   * @param options - Optional storage options
   * @returns StorageFile instance with cached metadata
   *
   * @example
   * ```typescript
   * import { createReadStream } from "fs";
   *
   * const stream = createReadStream("./large-video.mp4");
   * const file = await storage.putStream(stream, "videos/upload.mp4");
   * ```
   */
  putStream(stream: Readable, location: string, options?: PutOptions): Promise<StorageFile>;
  /**
   * Store a file from a URL
   *
   * Downloads the file from the URL and stores it.
   *
   * @param url - URL to download from
   * @param location - Destination path in storage
   * @param options - Optional storage options
   * @returns StorageFile instance
   *
   * @example
   * ```typescript
   * const file = await storage.putFromUrl(
   *   "https://example.com/image.jpg",
   *   "images/downloaded.jpg"
   * );
   * ```
   */
  putFromUrl(url: string, location: string, options?: PutOptions): Promise<StorageFile>;
  /**
   * Store a file from base64 data URL
   *
   * @param dataUrl - Data URL (data:image/png;base64,iVBORw0KG...)
   * @param location - Destination path in storage
   * @param options - Optional storage options
   * @returns StorageFile instance
   *
   * @example
   * ```typescript
   * const file = await storage.putFromBase64(
   *   "data:image/png;base64,iVBORw0KGgoAAAANS...",
   *   "images/upload.png"
   * );
   * ```
   */
  putFromBase64(dataUrl: string, location: string, options?: PutOptions): Promise<StorageFile>;
  /**
   * Retrieve file contents as a Buffer
   *
   * Downloads the entire file into memory. For large files,
   * consider using `getStream()` instead.
   *
   * @param location - Path to the file in storage
   * @returns Buffer containing file contents
   * @throws Error if file not found
   *
   * @example
   * ```typescript
   * const buffer = await storage.get("documents/report.pdf");
   * const content = buffer.toString("utf-8");
   * ```
   */
  get(location: string): Promise<Buffer>;
  /**
   * Retrieve file contents as a readable stream
   *
   * Streams file data without loading entire file into memory.
   * Ideal for large files or when piping to a response.
   *
   * @param location - Path to the file in storage
   * @returns Readable stream of file contents
   * @throws Error if file not found
   *
   * @example
   * ```typescript
   * const stream = await storage.getStream("videos/large.mp4");
   * stream.pipe(response.raw);
   * ```
   */
  getStream(location: string): Promise<Readable>;
  /**
   * Delete a file from storage
   *
   * @param location - Path to the file, or a StorageFile instance
   * @returns `true` if deleted, `false` if file not found
   *
   * @example
   * ```typescript
   * // By path
   * await storage.delete("temp/old-file.txt");
   *
   * // From StorageFile instance
   * const file = await storage.put(buffer, "temp/file.txt");
   * await storage.delete(file);
   * ```
   */
  delete(location: string | StorageFile): Promise<boolean>;
  /**
   * Delete multiple files at once
   *
   * Performs batch deletion for efficiency. Returns results for each file
   * including success/failure status.
   *
   * @param locations - Array of file paths to delete
   * @returns Array of delete results with status for each file
   *
   * @example
   * ```typescript
   * const results = await storage.deleteMany([
   *   "temp/file1.txt",
   *   "temp/file2.txt",
   *   "temp/file3.txt"
   * ]);
   *
   * for (const result of results) {
   *   console.log(`${result.location}: ${result.deleted ? "deleted" : result.error}`);
   * }
   * ```
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;
  /**
   * Delete a directory
   *
   * @param directoryPath - Path to the directory
   */
  deleteDirectory(directoryPath: string): Promise<boolean>;
  /**
   * Check if a file exists in storage
   *
   * @param location - Path to check
   * @returns `true` if file exists, `false` otherwise
   *
   * @example
   * ```typescript
   * if (await storage.exists("config/settings.json")) {
   *   const config = await storage.get("config/settings.json");
   * }
   * ```
   */
  exists(location: string): Promise<boolean>;
  /**
   * Copy a file to a new location
   *
   * Creates a copy of the file at the destination path.
   * The original file remains unchanged.
   *
   * @param from - Source path or StorageFile instance
   * @param to - Destination path
   * @returns StorageFile instance at the new location
   *
   * @example
   * ```typescript
   * // Copy by path
   * const backup = await storage.copy("documents/report.pdf", "backups/report.pdf");
   *
   * // Copy from StorageFile
   * const original = await storage.file("documents/report.pdf");
   * const backup = await storage.copy(original, "backups/report.pdf");
   * ```
   */
  copy(from: string | StorageFile, to: string): Promise<StorageFile>;
  /**
   * Move a file to a new location
   *
   * Moves the file to the destination path. The original file
   * is deleted after successful copy.
   *
   * @param from - Source path or StorageFile instance
   * @param to - Destination path
   * @returns StorageFile instance at the new location
   *
   * @example
   * ```typescript
   * // Move by path
   * const file = await storage.move("uploads/temp.jpg", "images/photo.jpg");
   *
   * // Move from StorageFile
   * const temp = await storage.file("uploads/temp.jpg");
   * const final = await storage.move(temp, "images/photo.jpg");
   * ```
   */
  move(from: string | StorageFile, to: string): Promise<StorageFile>;
  /**
   * Copy an entire directory recursively
   *
   * Copies all files from the source directory to the destination directory,
   * preserving the directory structure.
   *
   * @param from - Source directory path
   * @param to - Destination directory path
   * @param options - Optional concurrency control
   * @returns Number of files copied
   *
   * @example
   * ```typescript
   * // Copy entire directory
   * const count = await storage.copyDirectory("uploads/temp", "uploads/final");
   * console.log(`Copied ${count} files`);
   *
   * // With concurrency limit
   * const count = await storage.copyDirectory("large-dir", "backup", {
   *   concurrency: 10
   * });
   * ```
   */
  copyDirectory(from: string, to: string, options?: {
    concurrency?: number;
  }): Promise<number>;
  /**
   * Move an entire directory recursively
   *
   * Moves all files from the source directory to the destination directory,
   * then deletes the source directory.
   *
   * @param from - Source directory path
   * @param to - Destination directory path
   * @param options - Optional concurrency control
   * @returns Number of files moved
   *
   * @example
   * ```typescript
   * const count = await storage.moveDirectory("uploads/temp", "uploads/final");
   * console.log(`Moved ${count} files`);
   * ```
   */
  moveDirectory(from: string, to: string, options?: {
    concurrency?: number;
  }): Promise<number>;
  /**
   * Upload a local filesystem directory into storage
   *
   * Recursively walks the local directory, applies an optional filter, then
   * streams each file into storage. Uploads run in concurrent batches for
   * efficiency. Failures are collected â€” a single failed file never aborts
   * the entire operation (mirrors the contract of `deleteMany`).
   *
   * @param localDirPath  - Absolute path of the local directory to upload
   * @param destination   - Target prefix in storage (e.g. "uploads/assets")
   * @param options       - Concurrency, filter, progress callback, put options
   * @returns             - { uploaded, failed, total }
   *
   * @example
   * ```typescript
   * const result = await storage.putDirectory("./public/assets", "cdn/assets", {
   *   concurrency: 10,
   *   filter: (_, rel) => !rel.startsWith("."),
   *   onProgress: (done, total) => console.log(`${done}/${total}`),
   * });
   *
   * console.log(`Uploaded: ${result.uploaded.length}, Failed: ${result.failed.length}`);
   * ```
   */
  putDirectory(localDirPath: string, destination: string, options?: PutDirectoryOptions): Promise<PutDirectoryResult>;
  /**
   * Walk a local directory recursively and return all file paths
   *
   * @param dirPath - Absolute local directory path
   * @returns Array of { absolute, relative } file path pairs
   * @internal
   */
  private walkLocalDirectory;
  /**
   * Empty a directory without deleting the directory itself
   *
   * Deletes all files within the directory but preserves the directory structure.
   *
   * @param path - Directory path to empty
   * @returns Number of files deleted
   *
   * @example
   * ```typescript
   * const count = await storage.emptyDirectory("uploads/temp");
   * console.log(`Deleted ${count} files`);
   * ```
   */
  emptyDirectory(path: string): Promise<number>;
  /**
   * List files in a directory
   *
   * Returns file information for all files in the specified directory.
   * Supports recursive listing and pagination.
   *
   * @param directory - Directory path (defaults to root)
   * @param options - List options (recursive, limit, cursor)
   * @returns Array of file information objects
   *
   * @example
   * ```typescript
   * // List all files in uploads
   * const files = await storage.list("uploads");
   *
   * // Recursive listing with limit
   * const files = await storage.list("uploads", {
   *   recursive: true,
   *   limit: 100
   * });
   * ```
   */
  list(directory?: string, options?: ListOptions): Promise<StorageFileInfo[]>;
  /**
   * Get the public URL for a file
   *
   * Returns the URL where the file can be accessed. For local storage,
   * this is typically a path prefix. For cloud storage, this is the
   * bucket URL or CDN URL.
   *
   * @param location - File path
   * @returns Public URL string
   *
   * @example
   * ```typescript
   * const url = storage.url("images/photo.jpg");
   * // Local: "/uploads/images/photo.jpg"
   * // S3: "https://bucket.s3.amazonaws.com/images/photo.jpg"
   * ```
   */
  url(location: string): string;
  /**
   * Get a temporary signed URL with expiration
   *
   * Creates a URL that provides temporary access to the file.
   * For cloud storage, this uses presigned URLs.
   * For local storage, this uses HMAC-signed tokens.
   *
   * @param location - File path
   * @param expiresIn - Seconds until URL expires (default: 3600)
   * @returns Signed URL string
   *
   * @example
   * ```typescript
   * // URL valid for 1 hour
   * const url = await storage.temporaryUrl("private/document.pdf");
   *
   * // URL valid for 24 hours
   * const url = await storage.temporaryUrl("private/document.pdf", 86400);
   * ```
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;
  /**
   * Get file metadata without downloading the file
   *
   * Retrieves information about a file including size, last modified date,
   * and MIME type without downloading the file contents.
   *
   * @param location - File path
   * @returns File information object
   * @throws Error if file not found
   *
   * @example
   * ```typescript
   * const info = await storage.metadata("documents/report.pdf");
   * console.log(`Size: ${info.size} bytes`);
   * console.log(`Type: ${info.mimeType}`);
   * console.log(`Modified: ${info.lastModified}`);
   * ```
   */
  metadata(location: string): Promise<StorageFileInfo>;
  /**
   * Get file size in bytes
   *
   * Shortcut for `metadata(location).size`.
   *
   * @param location - File path
   * @returns File size in bytes
   * @throws Error if file not found
   */
  size(location: string): Promise<number>;
  /**
   * Get a StorageFile instance for OOP-style operations
   *
   * Creates a `StorageFile` wrapper for the specified path,
   * allowing fluent method chaining for file operations.
   *
   * @param location - File path
   * @returns StorageFile instance
   *
   * @example
   * ```typescript
   * const file = await storage.file("uploads/image.jpg");
   *
   * // Properties
   * console.log(file.name);       // "image.jpg"
   * console.log(file.extension);  // "jpg"
   *
   * // Operations
   * await file.copy("backup/image.jpg");
   * await file.delete();
   * ```
   */
  file(location: string): StorageFile;
  /**
   * Convert various input types to Buffer
   *
   * @param file - Input file in various formats
   * @returns Buffer containing file contents
   * @internal
   */
  protected toBuffer(file: UploadedFile | Buffer | string | Readable): Promise<Buffer>;
  /**
   * Check if value is a Readable stream
   *
   * @param value - Value to check
   * @returns True if value is a Readable stream
   * @internal
   */
  protected isReadable(value: unknown): value is Readable;
  /**
   * Convert a Readable stream to Buffer
   *
   * @param stream - Readable stream
   * @returns Buffer containing stream contents
   * @internal
   */
  protected streamToBuffer(stream: Readable): Promise<Buffer>;
  /**
   * Prepend a prefix to a location path
   *
   * Useful for organizing files into directories.
   *
   * @param prefix - Prefix to add (e.g., "uploads")
   * @param location - Original location path
   * @returns Combined path with prefix
   *
   * @example
   * ```typescript
   * storage.prepend("uploads", "image.jpg"); // "uploads/image.jpg"
   * storage.prepend("uploads/", "/image.jpg"); // "uploads/image.jpg"
   * ```
   */
  prepend(prefix: string, location: string): string;
  /**
   * Append a suffix to a location path (before extension)
   *
   * Useful for creating variants of files (thumbnails, etc.).
   *
   * @param location - Original location path
   * @param suffix - Suffix to add before extension
   * @returns Path with suffix added before extension
   *
   * @example
   * ```typescript
   * storage.append("image.jpg", "_thumb"); // "image_thumb.jpg"
   * storage.append("document.pdf", "_v2"); // "document_v2.pdf"
   * ```
   */
  append(location: string, suffix: string): string;
}
//#endregion
export { ScopedStorage };
//# sourceMappingURL=scoped-storage.d.mts.map