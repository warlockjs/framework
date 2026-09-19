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
