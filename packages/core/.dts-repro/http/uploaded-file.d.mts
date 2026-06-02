import { StorageFile } from "../storage/storage-file.mjs";
import { StorageDriverName } from "../storage/types.mjs";
import { ScopedStorage } from "../storage/scoped-storage.mjs";
import { storage } from "../storage/storage.mjs";
import { Image, ImageFormat, ImageTransformOptions } from "../image/image.mjs";
import { ImageTransformCallback, PrefixConfig, SaveAsOptions, SaveOptions, UploadedFileImageOptions } from "./uploads-types.mjs";
import { MultipartFile } from "@fastify/multipart";

//#region ../../@warlock.js/core/src/http/uploaded-file.d.ts
type UploadedFileMetadata = {
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  width?: number;
  height?: number;
};
/**
 * Options for validating file before saving
 */
type FileValidationOptions = {
  /**
   * List of allowed MIME types
   *
   * @example ["image/jpeg", "image/png", "image/webp"]
   */
  allowedMimeTypes?: string[];
  /**
   * List of allowed file extensions (without dot)
   *
   * @example ["jpg", "jpeg", "png", "webp"]
   */
  allowedExtensions?: string[];
  /**
   * Maximum file size in bytes
   *
   * @example 5 * 1024 * 1024 // 5MB
   */
  maxSize?: number;
};
/**
 * UploadedFile - Handles multipart file uploads with storage and image integration
 *
 * Provides a fluent API for validating, transforming, and saving uploaded files
 * to various storage drivers (local, S3, R2, etc.).
 *
 * @example
 * ```typescript
 * // Simple save with random name
 * const file = await uploadedFile.save("avatars");
 *
 * // Original name with date prefix
 * const file = await uploadedFile.save("avatars", {
 *   name: "original",
 *   prefix: { format: "yyyy/mm/dd", as: "directory" }
 * });
 *
 * // With image transformations
 * const file = await uploadedFile
 *   .resize(800, 600)
 *   .quality(85)
 *   .format("webp")
 *   .save("avatars");
 *
 * // Different storage driver
 * const file = await uploadedFile.use("s3").save("avatars");
 * ```
 */
declare class UploadedFile {
  protected readonly fileData: MultipartFile;
  /**
   * File buffered content
   * @internal
   */
  protected bufferedFileContent?: Buffer;
  /**
   * Upload file hash (SHA-256)
   *
   * Populated after file is saved.
   */
  hash: string;
  /**
   * Selected storage driver
   * @internal
   */
  protected _storage: ScopedStorage;
  /**
   * Saved StorageFile reference
   * @internal
   */
  protected _storageFile?: StorageFile;
  /**
   * Queued image options (high-level API)
   * @internal
   */
  protected _imageOptions: UploadedFileImageOptions;
  /**
   * Full transform options or callback
   * @internal
   */
  protected _transformConfig?: ImageTransformOptions | ImageTransformCallback;
  /**
   * Create a new UploadedFile instance
   *
   * @param fileData - Multipart file data from Fastify
   * @throws Error if file data is invalid
   */
  constructor(fileData: MultipartFile);
  /**
   * Get file name (sanitized)
   *
   * Returns the original filename with special characters removed/replaced.
   */
  get name(): string;
  /**
   * Get file MIME type
   *
   * @example "image/jpeg", "application/pdf"
   */
  get mimeType(): string;
  /**
   * Get file extension (lowercase, without dot)
   *
   * @example "jpg", "png", "pdf"
   */
  get extension(): string;
  /**
   * Get file metadata
   */
  metadata(): Promise<UploadedFileMetadata>;
  /**
   * Get file size in bytes
   *
   * Buffers the file content if not already buffered.
   */
  size(): Promise<number>;
  /**
   * Get file buffer
   *
   * Caches the buffer after first call for efficiency.
   */
  buffer(): Promise<Buffer>;
  /**
   * Check if file is an image based on MIME type
   */
  get isImage(): boolean;
  /**
   * Check if file is a video based on MIME type
   */
  get isVideo(): boolean;
  /**
   * Check if file is an audio based on MIME type
   */
  get isAudio(): boolean;
  /**
   * Select a specific storage driver for this upload
   *
   * Returns this instance for chaining. The driver is used
   * when `save()` or `saveAs()` is called.
   *
   * @param driver - Driver name from storage configuration
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.use("s3").save("avatars");
   * await file.use("r2").save("cdn/images");
   * ```
   */
  use(driver: StorageDriverName): this;
  /**
   * Resize the image before saving
   *
   * Only applies to image files. Non-image files ignore this.
   *
   * @param width - Target width in pixels
   * @param height - Optional target height (maintains aspect ratio if omitted)
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.resize(800).save("thumbnails");
   * await file.resize(400, 400).save("avatars");
   * ```
   */
  resize(width: number, height?: number): this;
  /**
   * Set image output quality
   *
   * Quality affects file size and visual fidelity.
   * Only applies to formats that support quality (JPEG, WebP, AVIF).
   *
   * @param value - Quality value (1-100)
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.quality(85).save("images");
   * ```
   */
  quality(value: number): this;
  /**
   * Convert image to a specific format
   *
   * Changes the output format and updates the file extension accordingly.
   *
   * @param format - Target image format (jpeg, png, webp, avif, etc.)
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.format("webp").save("images");
   * await file.resize(800).format("avif").quality(80).save("optimized");
   * ```
   */
  format(format: ImageFormat): this;
  /**
   * Rotate the image
   *
   * @param degrees - Rotation angle in degrees (positive = clockwise)
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.rotate(90).save("rotated");
   * ```
   */
  rotate(degrees: number): this;
  /**
   * Apply blur effect to the image
   *
   * @param sigma - Blur intensity (default: 3, minimum: 0.3)
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.blur(5).save("blurred");
   * ```
   */
  blur(sigma?: number): this;
  /**
   * Convert image to grayscale (black and white)
   *
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * await file.grayscale().save("bw-images");
   * ```
   */
  grayscale(): this;
  /**
   * Apply full image transformations
   *
   * Provides complete control over image processing. Can be used with:
   * - An options object for predefined transforms
   * - A callback function for chained operations
   *
   * @param config - Transform options or callback function
   * @returns This instance for chaining
   *
   * @example
   * ```typescript
   * // Using options object
   * await file.transform({
   *   resize: { width: 800, fit: "inside" },
   *   quality: 85
   * }).save("images");
   *
   * // Using callback for full control
   * await file.transform(img =>
   *   img.resize({ width: 800 })
   *      .watermark("logo.png", { gravity: "southeast" })
   *      .sharpen()
   * ).save("products");
   * ```
   */
  transform(config: ImageTransformOptions | ImageTransformCallback): this;
  /**
   * Get an Image instance for advanced manipulation
   *
   * Returns an Image instance from the file buffer for manual processing.
   * Use this when you need operations not covered by the fluent API.
   *
   * @returns Promise resolving to Image instance
   *
   * @example
   * ```typescript
   * const img = await file.toImage();
   * await img
   *   .resize({ width: 800 })
   *   .watermark("logo.png", { gravity: "southeast" })
   *   .save("path/to/output.jpg");
   * ```
   */
  toImage(): Promise<Image>;
  /**
   * Get file width and height (only for images)
   *
   * @returns Dimensions object, or empty object if not an image
   */
  dimensions(): Promise<{
    width?: number;
    height?: number;
  }>;
  /**
   * Validate file against the given options
   *
   * @param options - Validation rules
   * @throws Error if validation fails
   *
   * @example
   * ```typescript
   * await file.validate({
   *   allowedMimeTypes: ["image/jpeg", "image/png"],
   *   maxSize: 5 * 1024 * 1024 // 5MB
   * });
   * ```
   */
  validate(options: FileValidationOptions): Promise<void>;
  /**
   * Save the file to a directory with automatic naming
   * Keep in mind to use only relative path to the root of storage
   * If you are using local driver
   * Uses the configured naming strategy and prefix options to generate
   * the final path. Returns a StorageFile for accessing file metadata.
   *
   * @param directory - Target directory path
   * @param options - Save options (name, prefix, driver, validate)
   * @returns StorageFile instance with file metadata and operations
   *
   * @example
   * ```typescript
   * // Random name (default)
   * await file.save("avatars");
   * // → avatars/x7k9m2p4.jpg
   *
   * // Original name
   * await file.save("avatars", { name: "original" });
   * // → avatars/photo.jpg
   *
   * // With date directory
   * await file.save("avatars", {
   *   prefix: { format: "yyyy/mm/dd", as: "directory" }
   * });
   * // → avatars/2025/12/21/x7k9m2p4.jpg
   *
   * // Original name with datetime prefix
   * await file.save("avatars", { name: "original", prefix: true });
   * // → avatars/21-12-2025-16-45-30-photo.jpg
   * ```
   */
  save(directory: string, options?: SaveOptions): Promise<StorageFile>;
  /**
   * Save the file to an explicit path
   *
   * Unlike `save()`, this method uses the exact path you provide.
   * No automatic naming or prefix is applied.
   *
   * @param location - Full file path (directory + filename)
   * @param options - Save options (driver, validate)
   * @returns StorageFile instance with file metadata
   *
   * @example
   * ```typescript
   * await file.saveAs("avatars/profile-123.png");
   * await file.saveAs("products/2025/featured-image.webp");
   * ```
   */
  saveAs(location: string, options?: SaveAsOptions): Promise<StorageFile>;
  /**
   * Get the StorageFile reference if file has been saved
   *
   * Returns undefined if file hasn't been saved yet.
   */
  get storageFile(): StorageFile | undefined;
  /**
   * Execute save to the specified location
   * @internal
   */
  protected saveToLocation(location: string, driver?: StorageDriverName): Promise<StorageFile>;
  /**
   * Get processed content (with transforms applied if applicable)
   * @internal
   */
  protected getProcessedContent(): Promise<Buffer>;
  /**
   * Apply high-level image options
   * @internal
   */
  protected applyImageOptions(img: Image): Image;
  /**
   * Check if any transforms are queued
   * @internal
   */
  protected hasTransforms(): boolean;
  /**
   * Resolve storage instance to use
   * @internal
   */
  protected resolveStorage(driver?: StorageDriverName): ScopedStorage | typeof storage;
  /**
   * Resolve the filename based on options and config
   * @internal
   */
  protected resolveFilename(options?: SaveOptions): string;
  /**
   * Resolve prefix based on options and config
   * @internal
   */
  protected resolvePrefix(prefix?: PrefixConfig): string;
  /**
   * Format a date prefix with the given format
   * @internal
   */
  protected formatDatePrefix(format: string, as: "file" | "directory"): string;
  /**
   * Format current date using token-based format string
   * @internal
   */
  protected formatDate(format: string): string;
  /**
   * Build final location from directory, prefix, and filename
   * @internal
   */
  protected buildLocation(directory: string, prefix: string, filename: string): string;
  /**
   * Get final extension (accounting for format changes)
   * @internal
   */
  protected getFinalExtension(): string;
  /**
   * Get final MIME type (accounting for format changes)
   * @internal
   */
  protected getFinalMimeType(): string;
  /**
   * Adjust location to use correct extension if format changed
   * @internal
   */
  protected adjustLocationForFormat(location: string): string;
  /**
   * Convert to JSON representation
   *
   * Includes file metadata and base64 content for serialization.
   */
  toJSON(): Promise<{
    name: string;
    mimeType: string;
    extension: string;
    size: number;
    isImage: boolean;
    isVideo: boolean;
    isAudio: boolean;
    dimensions: {
      width?: number;
      height?: number;
    } | undefined;
    base64: string;
  }>;
}
//#endregion
export { FileValidationOptions, UploadedFile };
//# sourceMappingURL=uploaded-file.d.mts.map