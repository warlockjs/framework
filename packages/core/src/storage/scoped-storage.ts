import type { Readable } from "stream";
import type { UploadedFile } from "../http";
import { StorageFile } from "./storage-file";
import type {
  DeleteManyResult,
  ListOptions,
  PutOptions,
  StorageDriverContract,
  StorageDriverType,
  StorageFileInfo,
} from "./types";

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
export class ScopedStorage {
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
  public constructor(driver: StorageDriverContract) {
    this._driver = driver;
  }

  // ============================================================
  // Properties
  // ============================================================

  /**
   * Get the driver name
   *
   * @returns The name identifier of the underlying driver (e.g., "local", "s3", "r2")
   */
  public get name(): StorageDriverType {
    return this._driver.name;
  }

  /**
   * Get the underlying driver instance
   *
   * Use this for advanced operations that require direct driver access.
   *
   * @returns The raw storage driver
   */
  public get driver(): StorageDriverContract {
    return this._driver;
  }

  // ============================================================
  // File Operations
  // ============================================================

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
  public async put(
    file: UploadedFile | Buffer | string | Readable,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFile> {
    const buffer = await this.toBuffer(file);
    const data = await this._driver.put(buffer, location, options);
    return StorageFile.fromData(data, this._driver);
  }

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
  public async putStream(
    stream: Readable,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFile> {
    const data = await this._driver.putStream(stream, location, options);
    return StorageFile.fromData(data, this._driver);
  }

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
  public async get(location: string): Promise<Buffer> {
    return this._driver.get(location);
  }

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
  public async getStream(location: string): Promise<Readable> {
    return this._driver.getStream(location);
  }

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
  public async delete(location: string | StorageFile): Promise<boolean> {
    const path = typeof location === "string" ? location : location.path;
    return this._driver.delete(path);
  }

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
  public async deleteMany(locations: string[]): Promise<DeleteManyResult[]> {
    return this._driver.deleteMany(locations);
  }

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
  public async exists(location: string): Promise<boolean> {
    return this._driver.exists(location);
  }

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
  public async copy(from: string | StorageFile, to: string): Promise<StorageFile> {
    const fromPath = typeof from === "string" ? from : from.path;
    const data = await this._driver.copy(fromPath, to);
    return StorageFile.fromData(data, this._driver);
  }

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
  public async move(from: string | StorageFile, to: string): Promise<StorageFile> {
    const fromPath = typeof from === "string" ? from : from.path;
    const data = await this._driver.move(fromPath, to);
    return StorageFile.fromData(data, this._driver);
  }

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
  public async list(directory?: string, options?: ListOptions): Promise<StorageFileInfo[]> {
    return this._driver.list(directory || "", options);
  }

  // ============================================================
  // URL Operations
  // ============================================================

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
  public url(location: string): string {
    return this._driver.url(location);
  }

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
  public async temporaryUrl(location: string, expiresIn?: number): Promise<string> {
    return this._driver.temporaryUrl(location, expiresIn);
  }

  // ============================================================
  // Metadata Operations
  // ============================================================

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
   * const info = await storage.getInfo("documents/report.pdf");
   * console.log(`Size: ${info.size} bytes`);
   * console.log(`Type: ${info.mimeType}`);
   * console.log(`Modified: ${info.lastModified}`);
   * ```
   */
  public async getInfo(location: string): Promise<StorageFileInfo> {
    return this._driver.getInfo(location);
  }

  /**
   * Get file size in bytes
   *
   * Shortcut for `getInfo(location).size`.
   *
   * @param location - File path
   * @returns File size in bytes
   * @throws Error if file not found
   */
  public async size(location: string): Promise<number> {
    return this._driver.size(location);
  }

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
  public async file(location: string): Promise<StorageFile> {
    return new StorageFile(location, this._driver);
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Convert various input types to Buffer
   *
   * @param file - Input file in various formats
   * @returns Buffer containing file contents
   * @internal
   */
  protected async toBuffer(file: UploadedFile | Buffer | string | Readable): Promise<Buffer> {
    // Already a buffer
    if (Buffer.isBuffer(file)) {
      return file;
    }

    // String content
    if (typeof file === "string") {
      return Buffer.from(file);
    }

    // Readable stream - collect into buffer
    if (this.isReadable(file)) {
      return this.streamToBuffer(file as Readable);
    }

    // UploadedFile
    return (file as UploadedFile).buffer();
  }

  /**
   * Check if value is a Readable stream
   *
   * @param value - Value to check
   * @returns True if value is a Readable stream
   * @internal
   */
  protected isReadable(value: unknown): value is Readable {
    return (
      typeof value === "object" &&
      value !== null &&
      "pipe" in value &&
      typeof (value as Readable).pipe === "function"
    );
  }

  /**
   * Convert a Readable stream to Buffer
   *
   * @param stream - Readable stream
   * @returns Buffer containing stream contents
   * @internal
   */
  protected async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks as unknown as Uint8Array[]);
  }

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
  public prepend(prefix: string, location: string): string {
    return `${prefix.replace(/\/$/, "")}/${location.replace(/^\//, "")}`;
  }

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
  public append(location: string, suffix: string): string {
    const lastDot = location.lastIndexOf(".");
    if (lastDot === -1) {
      return `${location}${suffix}`;
    }
    return `${location.substring(0, lastDot)}${suffix}${location.substring(lastDot)}`;
  }
}
