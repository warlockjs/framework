import sharp, { FormatEnum } from "sharp";

//#region ../../@warlock.js/core/src/image/image.d.ts
type ImageFormat = keyof FormatEnum;
type ImageInput = string | Buffer | Uint8Array | ArrayBuffer;
/**
 * Watermark configuration for deferred execution
 */
type WatermarkConfig = {
  image: ImageInput | Image;
  options: sharp.OverlayOptions;
};
/**
 * Operation descriptor for deferred pipeline execution.
 * All operations are stored and executed at save/toBuffer time.
 */
type ImageOperation = {
  type: "resize";
  options: sharp.ResizeOptions;
} | {
  type: "crop";
  options: sharp.Region;
} | {
  type: "rotate";
  angle: number;
} | {
  type: "flip";
} | {
  type: "flop";
} | {
  type: "blur";
  sigma: number;
} | {
  type: "sharpen";
  options?: sharp.SharpenOptions;
} | {
  type: "blackAndWhite";
} | {
  type: "opacity";
  value: number;
} | {
  type: "negate";
  options?: sharp.NegateOptions;
} | {
  type: "tint";
  color: sharp.Color;
} | {
  type: "trim";
  options?: sharp.TrimOptions;
} | {
  type: "watermark";
  config: WatermarkConfig;
} | {
  type: "watermarks";
  configs: WatermarkConfig[];
};
/**
 * Transformation options that can be applied in batch via `apply()` method.
 *
 * **Execution Order (when using apply()):**
 * 1. resize - Resize first to work with correct dimensions
 * 2. crop - Crop after resize to extract the desired region
 * 3. rotate - Rotation after sizing
 * 4. flip/flop - Mirror operations
 * 5. blackAndWhite/grayscale - Color space conversion
 * 6. blur - Blur effect
 * 7. sharpen - Sharpen effect
 * 8. tint - Color overlay
 * 9. negate - Invert colors
 * 10. opacity - Transparency (applied via composite)
 * 11. format/quality - Applied on save/export
 */
type ImageTransformOptions = {
  /**
   * Output quality (1-100), applied based on final format
   */
  quality?: number;
  /**
   * Output format (jpeg, png, webp, avif, etc.)
   */
  format?: ImageFormat;
  /**
   * Resize options
   */
  resize?: sharp.ResizeOptions;
  /**
   * Crop/extract region
   */
  crop?: sharp.Region;
  /**
   * Rotation angle in degrees
   */
  rotate?: number;
  /**
   * Flip vertically (top to bottom)
   */
  flip?: boolean;
  /**
   * Flop horizontally (left to right)
   */
  flop?: boolean;
  /**
   * Convert to black and white
   */
  blackAndWhite?: boolean;
  /**
   * Alias for blackAndWhite
   */
  grayscale?: boolean;
  /**
   * Blur sigma (must be >= 0.3)
   */
  blur?: number;
  /**
   * Sharpen options
   */
  sharpen?: sharp.SharpenOptions | boolean;
  /**
   * Tint color
   */
  tint?: sharp.Color;
  /**
   * Negate/invert colors
   */
  negate?: sharp.NegateOptions | boolean;
  /**
   * Opacity (0-100)
   */
  opacity?: number;
  /**
   * Trim options
   */
  trim?: sharp.TrimOptions | boolean;
  /**
   * Single watermark
   */
  watermark?: WatermarkConfig;
  /**
   * Multiple watermarks
   */
  watermarks?: WatermarkConfig[];
};
/**
 * Internal options stored for deferred application
 */
type InternalOptions = {
  quality?: number;
  format?: ImageFormat;
};
/**
 * Image manipulation class with deferred pipeline execution.
 *
 * **Important:** This class requires the `sharp` package to be installed.
 * Install it with: `warlock add image` or `npm install sharp`
 *
 * Sharp is lazy-loaded on the first async operation (save, toBuffer, etc.),
 * so the constructor and all chainable methods remain synchronous.
 *
 * All operations are synchronous and stored as descriptors.
 * The pipeline is executed only when calling output methods:
 * - `save()` - Save to file
 * - `toBuffer()` - Get as buffer
 * - `toBase64()` - Get as base64 string
 * - `toDataUrl()` - Get as data URL
 *
 * @example
 * ```typescript
 * // All chaining is synchronous - single await at the end
 * await new Image("photo.jpg")
 *   .resize({ width: 800 })
 *   .watermark("logo.png", { gravity: "southeast" })
 *   .quality(85)
 *   .save("output.jpg");
 * ```
 */
declare class Image {
  /**
   * Image options that will be applied on save/export
   */
  protected options: InternalOptions;
  /**
   * Deferred operations pipeline
   */
  protected operations: ImageOperation[];
  /**
   * Cached metadata to avoid repeated async calls
   */
  protected cachedMetadata: sharp.Metadata | null;
  /**
   * Whether the pipeline has been executed
   */
  protected pipelineExecuted: boolean;
  /**
   * Sharp image object
   */
  readonly image: sharp.Sharp;
  /**
   * Formats that support quality option
   */
  protected static readonly QUALITY_FORMATS: string[];
  /**
   * Constructor
   */
  constructor(image: ImageInput | sharp.Sharp);
  /**
   * Create image instance from file path
   */
  static fromFile(path: string): Image;
  /**
   * Create image instance from buffer
   */
  static fromBuffer(buffer: Buffer): Image;
  /**
   * Create image instance from url
   */
  static fromUrl(url: string): Promise<Image>;
  /**
   * Add an operation to the deferred pipeline
   */
  protected addOperation(operation: ImageOperation): this;
  /**
   * Apply multiple transformations at once with a predefined execution order.
   *
   * This method ensures transformations are applied in a logical order:
   * resize → crop → rotate → flip/flop → colorspace → effects → opacity → format
   *
   * For custom ordering, use individual chained methods instead.
   */
  apply(options: ImageTransformOptions): this;
  /**
   * Set image opacity (0-100)
   */
  opacity(value: number): this;
  /**
   * Convert image to black and white
   */
  blackAndWhite(): this;
  /**
   * Alias for blackAndWhite
   */
  grayscale(): this;
  /**
   * Get image dimensions (cached after first call)
   */
  dimensions(): Promise<{
    width: number | undefined;
    height: number | undefined;
  }>;
  /**
   * Get image metadata (cached after first call)
   *
   * The metadata is cached to avoid repeated async operations.
   * Use `refreshMetadata()` to force a fresh fetch.
   */
  metadata(): Promise<sharp.Metadata>;
  /**
   * Force refresh of cached metadata
   *
   * Call this after transformations if you need updated metadata.
   */
  refreshMetadata(): Promise<sharp.Metadata>;
  /**
   * Clear cached metadata
   */
  clearMetadataCache(): this;
  /**
   * Resize image
   */
  resize(options: sharp.ResizeOptions): this;
  /**
   * Crop/extract a region from the image
   */
  crop(options: sharp.Region): this;
  /**
   * Set image quality (1-100)
   * Quality is stored and applied when saving/exporting
   * based on the final format.
   */
  quality(quality: number): this;
  /**
   * Execute the deferred pipeline - apply all stored operations
   */
  protected executePipeline(): Promise<sharp.Sharp>;
  /**
   * Execute a single operation
   */
  protected executeOperation(image: sharp.Sharp, operation: ImageOperation): Promise<void>;
  /**
   * Resolve an image input to a buffer
   */
  protected resolveImageBuffer(input: ImageInput | Image): Promise<Buffer>;
  /**
   * Apply format and quality options.
   * If no format is explicitly set, preserves the original format and applies
   * quality appropriately based on the format type.
   */
  protected applyFormatAndQuality(image: sharp.Sharp): Promise<void>;
  /**
   * Save to file
   */
  save(path: string): Promise<sharp.OutputInfo>;
  /**
   * Convert to webp and save to file
   */
  saveAsWebp(path: string): Promise<sharp.OutputInfo>;
  /**
   * Change the file format
   */
  format(format: ImageFormat): this;
  /**
   * Add watermark (deferred - executed at save time)
   */
  watermark(image: ImageInput | Image, options?: sharp.OverlayOptions): this;
  /**
   * Add multiple watermarks (deferred - executed at save time)
   */
  watermarks(configs: WatermarkConfig[]): this;
  /**
   * Rotate image
   */
  rotate(angle: number): this;
  /**
   * Flip image vertically (top to bottom)
   */
  flip(): this;
  /**
   * Flop image horizontally (left to right)
   */
  flop(): this;
  /**
   * Blur image
   */
  blur(sigma: number): this;
  /**
   * Convert to base64
   */
  toBase64(): Promise<string>;
  /**
   * Convert to data URL (base64 with mime type prefix)
   */
  toDataUrl(): Promise<string>;
  /**
   * Sharpen image
   */
  sharpen(options?: sharp.SharpenOptions): this;
  /**
   * Negate/invert image colors
   */
  negate(options?: sharp.NegateOptions): this;
  /**
   * Tint image with a color
   */
  tint(color: sharp.Color): this;
  /**
   * Trim edges from the image
   */
  trim(options?: sharp.TrimOptions): this;
  /**
   * Convert to buffer
   */
  toBuffer(): Promise<Buffer>;
  /**
   * Clone the image for separate transformations
   */
  clone(): Image;
  /**
   * Get the current stored options
   */
  getOptions(): Readonly<InternalOptions>;
  /**
   * Get the pending operations count
   */
  getPendingOperationsCount(): number;
  /**
   * Reset all stored options
   */
  resetOptions(): this;
  /**
   * Clear all pending operations
   */
  clearOperations(): this;
  /**
   * Reset the image to its initial state (clear operations and options)
   */
  reset(): this;
}
//#endregion
export { Image, ImageFormat, ImageInput, ImageTransformOptions, WatermarkConfig };
//# sourceMappingURL=image.d.mts.map