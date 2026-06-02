import { CloudStorageFileData, FileVisibility, StorageDriverContract, StorageFileData, StorageFileInfo } from "./types.mjs";
import { Readable } from "stream";

//#region ../../@warlock.js/core/src/storage/storage-file.d.ts
/**
 * StorageFile class - OOP wrapper for storage file operations
 *
 * Provides a fluent interface for working with files in storage,
 * wrapping the underlying driver operations.
 *
 * @example
 * ```typescript
 * const file = await storage.put(buffer, "uploads/image.jpg");
 *
 * // Properties (sync, from cached data)
 * file.name        // "image.jpg"
 * file.extension   // "jpg"
 * file.path        // "uploads/image.jpg"
 * file.hash        // "sha256:abc123..."
 *
 * // Operations
 * await file.copy("uploads/backup.jpg")
 * await file.move("archive/image.jpg")
 * await file.delete()
 *
 * // Content
 * const buffer = await file.contents();
 * const stream = await file.stream();
 * ```
 */
declare class StorageFile {
  /**
   * Relative file path
   */
  protected _path: string;
  /**
   * The driver instance
   */
  protected _driver: StorageDriverContract;
  /**
   * Cached file data (from put operations or lazy loaded)
   */
  protected _data?: StorageFileData;
  /**
   * Whether the file has been deleted
   */
  protected _deleted: boolean;
  /**
   * Create a new StorageFile instance
   *
   * @param path - Relative file path
   * @param driver - Driver instance
   * @param data - Optional initial data from put/copy operations
   */
  constructor(path: string, driver: StorageDriverContract, data?: StorageFileData);
  /**
   * Get the relative file path
   */
  get path(): string;
  /**
   * Get the file name (with extension)
   */
  get name(): string;
  /**
   * Get the file extension (without dot)
   */
  get extension(): string;
  /**
   * Get the directory path
   */
  get directory(): string;
  /**
   * Get the driver name
   */
  get driver(): string;
  /**
   * Check if file has been deleted
   */
  get isDeleted(): boolean;
  /**
   * Get public URL (sync if data cached, otherwise computed)
   */
  get url(): string;
  /**
   * Get the absolute filesystem path (local driver only)
   */
  get absolutePath(): string | undefined;
  /**
   * Get file hash (SHA-256, available from put operations)
   */
  get hash(): string | undefined;
  /**
   * Get cached file data, or fetch it if not available
   */
  data(): Promise<StorageFileData>;
  /**
   * Get file size in bytes
   */
  size(): Promise<number>;
  /**
   * Get MIME type
   */
  mimeType(): Promise<string>;
  /**
   * Get last modified date (fetches from driver)
   */
  lastModified(): Promise<Date | undefined>;
  /**
   * Get ETag (cloud drivers, fetches from driver)
   */
  etag(): Promise<string | undefined>;
  /**
   * Get file contents as Buffer
   */
  contents(): Promise<Buffer>;
  /**
   * Get file contents as readable stream
   */
  stream(): Promise<Readable>;
  /**
   * Get file contents as UTF-8 text
   */
  text(): Promise<string>;
  /**
   * Get file contents as base64 string
   */
  base64(): Promise<string>;
  /**
   * Get file contents as data URL
   */
  dataUrl(): Promise<string>;
  /**
   * Get a temporary signed URL
   *
   * @param expiresIn - Seconds until expiration (default: 3600)
   */
  temporaryUrl(expiresIn?: number): Promise<string>;
  /**
   * Check if the file exists
   */
  exists(): Promise<boolean>;
  /**
   * Copy the file to a new location
   *
   * @param destination - Destination path
   * @returns New StorageFile instance at destination
   */
  copy(destination: string): Promise<StorageFile>;
  /**
   * Move the file to a new location
   *
   * @param destination - Destination path
   * @returns This StorageFile instance with updated path
   */
  move(destination: string): Promise<this>;
  /**
   * Rename the file (move within same directory)
   *
   * @param newName - New file name
   * @returns This StorageFile instance with updated path
   */
  rename(newName: string): Promise<this>;
  /**
   * Delete the file
   *
   * @returns true if deleted, false if not found
   */
  delete(): Promise<boolean>;
  /**
   * Set file visibility (cloud drivers only)
   *
   * @param visibility - "public" or "private"
   * @throws Error if driver doesn't support visibility
   */
  setVisibility(visibility: FileVisibility): Promise<this>;
  /**
   * Get file visibility (cloud drivers only)
   *
   * @throws Error if driver doesn't support visibility
   */
  getVisibility(): Promise<FileVisibility>;
  /**
   * Set storage class (cloud drivers only)
   *
   * @param storageClass - Storage class (e.g., "STANDARD", "GLACIER")
   * @throws Error if driver doesn't support storage class
   */
  setStorageClass(storageClass: string): Promise<this>;
  /**
   * Ensure the file has not been deleted
   */
  protected ensureNotDeleted(): void;
  /**
   * Create a StorageFile instance from StorageFileData
   *
   * @param data - Storage file data from put/copy/move operations
   * @param driver - Driver instance
   */
  static fromData(data: StorageFileData | CloudStorageFileData, driver: StorageDriverContract): StorageFile;
  /**
   * Get file metadata
   */
  metadata(): Promise<StorageFileInfo>;
  /**
   * Determine if this file is an image type
   */
  isImage(): Promise<boolean>;
  /**
   * Determine if this file is a document type
   */
  isDocument(): Promise<boolean>;
  /**
   * Determine if this file is a pdf type
   */
  isPdf(): Promise<boolean>;
  /**
   * Determine if this file is an excel file (any support excel file)
   */
  isExcel(): Promise<boolean>;
  /**
   * Determine if this file is a doc file
   */
  isDoc(): Promise<boolean>;
  /**
   * Determine if this file is an audio type
   */
  isAudio(): Promise<boolean>;
  /**
   * Determine if this file is a video type
   */
  isVideo(): Promise<boolean>;
  /**
   * Convert to plain object (returns cached data or constructs it)
   */
  toJSON(): {
    path: string;
    name: string;
    extension: string;
    driver: string;
    url: string;
    hash?: string;
    size?: number;
    mimeType?: string;
  };
  /**
   * String representation
   */
  toString(): string;
}
//#endregion
export { StorageFile };
//# sourceMappingURL=storage-file.d.mts.map