import fs from "node:fs/promises";
import { Image } from "../../image";
import { HttpError } from "../errors";
import { detectImageFormat } from "./detect-image-format";
import type { VariantSourceFormat } from "./image-variant-types";

/**
 * Bounds and the expected format a source must match
 */
export type LoadVariantSourceOptions = {
  maxSourceBytes: number;
  maxSourcePixels: number;
  expectedFormat: VariantSourceFormat;
};

/**
 * Read a variant source in full and check it before it is decoded.
 *
 * The caller has already sniffed the format from the file head; this re-checks
 * the bytes actually read, the same buffer that is then resized, so the file
 * cannot be swapped between the check and the render.
 *
 * - bytes over `maxSourceBytes` → 413
 * - magic bytes that no longer match `expectedFormat` → 415
 * - a header sharp cannot read (e.g. avif without a decoder) → 415
 * - width × height over `maxSourcePixels` → 413, read from the header only
 *
 * @throws HttpError with status 413 or 415. Any other error (sharp missing,
 * I/O) propagates unchanged.
 */
export async function loadVariantSource(
  absolutePath: string,
  { maxSourceBytes, maxSourcePixels, expectedFormat }: LoadVariantSourceOptions,
): Promise<Image> {
  const buffer = await fs.readFile(absolutePath);

  if (buffer.length > maxSourceBytes) {
    throw new HttpError(413, "The source image is too large.");
  }

  if (detectImageFormat(buffer) !== expectedFormat) {
    throw new HttpError(415, "The source image changed format while it was read.");
  }

  // Constructed outside the try below: sharp being absent is a server fault
  // (500 with the install hint), not an unsupported image.
  const image = new Image(buffer);

  let width: number | undefined;
  let height: number | undefined;

  try {
    ({ width, height } = await image.metadata());
  } catch {
    throw new HttpError(415, "The source image cannot be decoded.");
  }

  if (!width || !height) {
    throw new HttpError(415, "The source image cannot be decoded.");
  }

  if (width * height > maxSourcePixels) {
    throw new HttpError(413, "The source image has too many pixels.");
  }

  return image;
}
