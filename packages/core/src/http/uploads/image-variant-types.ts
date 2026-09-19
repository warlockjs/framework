import type { ImageVariantDefinition, ImageVariantOutputFormat } from "../uploads-types";

/**
 * The `uploads.images` config after validation, with every default applied
 */
export type ResolvedImageVariantsConfig = {
  variants: Readonly<Record<string, ImageVariantDefinition>>;
  formats: readonly ImageVariantOutputFormat[];
  maxSourceBytes: number;
  maxSourcePixels: number;
  cacheDirectory: string;
};

/**
 * Raster formats a variant can be generated from, detected by magic bytes
 */
export type VariantSourceFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * Every format `detectImageFormat` can recognise, including the refused ones
 */
export type DetectedImageFormat = VariantSourceFormat | "gif" | "svg";

/**
 * Format a derivative is written in
 */
export type VariantOutputFormat = VariantSourceFormat;

/**
 * What the query string of an uploads request asks for
 */
export type UploadedFileQuery =
  | { type: "original" }
  | { type: "variant"; variant: string; format?: string }
  | { type: "invalid"; reason: string };

/**
 * One rendered size of an image produced by `generateImageVariants`.
 *
 * Field names match web's `ImageDescriptor`/`ImageVariantDescriptor`
 * (`web/src/image/types.ts`) field for field, so the result can be stored or
 * passed through loader data as is. Core does not import that type — web
 * depends on core, not the other way around — this is a structural match.
 */
export type GeneratedImageVariant = {
  /**
   * Actual rendered width, in pixels
   */
  width: number;

  /**
   * Actual rendered height, in pixels
   */
  height: number;

  /**
   * URL of the default-format rendition: `/uploads/<path>?variant=<name>`
   */
  url: string;

  /**
   * URLs of the extra configured formats, keyed by format
   */
  urls?: Partial<Record<ImageVariantOutputFormat, string>>;
};

/**
 * Serializable descriptor returned by `generateImageVariants`, matching web's
 * `ImageDescriptor` field for field.
 */
export type GeneratedImageDescriptor = {
  /**
   * The original source path: `/uploads/<path>`
   */
  src: string;

  /**
   * Intrinsic width of the source, in pixels
   */
  width: number;

  /**
   * Intrinsic height of the source, in pixels
   */
  height: number;

  /**
   * Every generated variant, keyed by name
   */
  variants: Readonly<Record<string, GeneratedImageVariant>>;

  /**
   * The extra formats configured in `uploads.images.formats`, when any
   */
  formats?: readonly ImageVariantOutputFormat[];
};
