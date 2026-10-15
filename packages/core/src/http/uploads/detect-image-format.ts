import type { DetectedImageFormat, VariantSourceFormat } from "./image-variant-types";

/**
 * Bytes `detectImageFormat` needs to see
 */
export const IMAGE_SIGNATURE_BYTES = 512;

function startsWith(buffer: Buffer, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("latin1");
}

/**
 * Detect an image format from its magic bytes, never from the file name.
 *
 * Recognises the variant sources (jpeg, png, webp, still avif) and the formats
 * that are refused but worth naming (gif, svg). An animated avif sequence
 * (`avis` brand) is not reported as avif.
 *
 * @returns the format, or `undefined` for anything else
 */
export function detectImageFormat(buffer: Buffer): DetectedImageFormat | undefined {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") return "webp";

  if (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a") return "gif";

  if (ascii(buffer, 4, 8) === "ftyp" && ascii(buffer, 8, 12) === "avif") return "avif";

  const head = buffer
    .subarray(0, IMAGE_SIGNATURE_BYTES)
    .toString("utf8")
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();

  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";

  return undefined;
}

const VARIANT_SOURCE_FORMATS: readonly DetectedImageFormat[] = ["jpeg", "png", "webp", "avif"];

/**
 * Whether a detected format can be the source of a variant. gif is refused
 * (animation is ambiguous) and svg is refused (not a raster).
 */
export function isVariantSourceFormat(
  format: DetectedImageFormat | undefined,
): format is VariantSourceFormat {
  return format !== undefined && VARIANT_SOURCE_FORMATS.includes(format);
}
