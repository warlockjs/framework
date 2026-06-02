import { DeleteManyResult, ListOptions, LocalStorageDriverOptions, PutOptions, StorageDriverContract, StorageDriverType, StorageFileData, StorageFileInfo, TemporaryTokenValidation } from "../types.mjs";
import { UploadedFile } from "../../http/uploaded-file.mjs";
import { Readable } from "stream";

//#region ../../@warlock.js/core/src/storage/drivers/local-driver.d.ts
/**
 * Local filesystem storage driver
 *
 * Stores files on the local filesystem with support for:
 * - File operations (put, get, delete, copy, move)
 * - Stream operations for large files
 * - Batch operations
 * - Signed temporary URLs
 */
declare class LocalDriver implements StorageDriverContract {
  options: LocalStorageDriverOptions;
  /**
   * Driver name
   */
  readonly name: StorageDriverType;
  /**
   * Root path for storage
   */
  protected root: string;
  /**
   * URL prefix for file URLs
   */
  protected urlPrefix: string;
  /**
   * URL prefix for temporary file URLs
   */
  protected temporaryUrlPrefix: string;
  /**
   * Secret key for signing temporary URLs
   */
  protected signatureKey?: string;
  /**
   * Cached Storage File Metadata
   */
  protected _metadata: Map<string, StorageFileInfo>;
  constructor(options?: LocalStorageDriverOptions);
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
   * Put file to local storage
   */
  put(file: Buffer | string | UploadedFile, location: string, options?: PutOptions): Promise<StorageFileData>;
  /**
   * Put file from a readable stream (for large files)
   */
  putStream(stream: Readable, location: string, options?: PutOptions): Promise<StorageFileData>;
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
   * Delete multiple files at once
   */
  deleteMany(locations: string[]): Promise<DeleteManyResult[]>;
  /**
   * Delete directory
   */
  deleteDirectory(directoryPath: string): Promise<boolean>;
  /**
   * Check if file exists
   */
  exists(location: string): Promise<boolean>;
  /**
   * Get public URL for file
   */
  url(location: string): string;
  /**
   * Get a temporary signed URL that expires
   * Returns a clean URL with encoded token: {temporaryUrlPrefix}/{token}
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration (default: 3600)
   */
  temporaryUrl(location: string, expiresIn?: number): Promise<string>;
  /**
   * Encode a temporary token containing path, expiry, and signature
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration
   */
  encodeTemporaryToken(location: string, expiresIn: number): string;
  /**
   * Validate a temporary URL token
   * Returns a result object with validation status, file info, and convenience methods
   *
   * @param token - The token from the URL
   */
  validateTemporaryToken(token: string): Promise<TemporaryTokenValidation>;
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
  copy(from: string, to: string): Promise<StorageFileData>;
  /**
   * Move file to a new location
   */
  move(from: string, to: string): Promise<StorageFileData>;
  /**
   * List files in a directory
   */
  list(directory: string, options?: ListOptions): Promise<StorageFileInfo[]>;
  /**
   * Get absolute filesystem path for a location
   */
  path(location: string): string;
  /**
   * Get the storage root directory
   */
  getRoot(): string;
  /**
   * Get absolute file path
   */
  protected getAbsolutePath(location: string): string;
  /**
   * Convert various input types to Buffer
   */
  protected toBuffer(file: Buffer | string | UploadedFile): Promise<Buffer>;
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
export { LocalDriver };
//# sourceMappingURL=local-driver.d.mts.map