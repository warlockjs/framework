import path from "node:path";
import type { DetectedImageFormat, VariantSourceFormat } from "./image-variant-types";

/**
 * Extensions an upload original may carry for each raster format that is
 * allowed to render inline. Anything else — including `.gif`, since gif is
 * not a variant source format — is never served inline, regardless of what
 * its bytes sniff as.
 */
const EXTENSION_IMAGE_FORMATS: Readonly<Record<string, VariantSourceFormat>> = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
  ".avif": "avif",
};

/**
 * Content type an inline response must advertise for each raster format,
 * used instead of an extension-derived guess.
 */
const INLINE_IMAGE_CONTENT_TYPES: Readonly<Record<VariantSourceFormat, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * Content type to serve an upload original inline with, or `undefined` when
 * it must go out as an attachment instead.
 *
 * `sendFile` sets `Content-Type` from the file's EXTENSION, not its bytes.
 * The inline branch in `uploaded-file.controller.ts` only sniffs the bytes to
 * decide "is this raster" — so a JPEG-signature file named `x.html` sniffed
 * as jpeg (raster, so "safe") would still have been sent by `sendFile` as
 * `text/html`: a polyglot JPEG/HTML stored-XSS vector, the reverse of the
 * already-fixed SVG-named-`.png` case.
 *
 * Inline is therefore only safe when the sniffed format AND the
 * extension-derived format agree — the extension maps to the SAME image
 * type the bytes sniffed as. Any mismatch (raster bytes under a non-image or
 * different-image extension) returns `undefined`, sending the caller to the
 * attachment path instead of trusting either signal alone.
 */
export function resolveInlineImageContentType(
  filePath: string,
  sniffedFormat: DetectedImageFormat | undefined,
): string | undefined {
  if (sniffedFormat === undefined) return undefined;

  const extensionFormat = EXTENSION_IMAGE_FORMATS[path.extname(filePath).toLowerCase()];

  if (extensionFormat === undefined || extensionFormat !== sniffedFormat) return undefined;

  return INLINE_IMAGE_CONTENT_TYPES[extensionFormat];
}
