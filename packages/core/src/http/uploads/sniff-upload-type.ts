import { detectImageFormat, IMAGE_SIGNATURE_BYTES } from "./detect-image-format";
import type { DetectedImageFormat } from "./image-variant-types";

/** Bytes {@link sniffUploadMimeType} reads from the start of a file. */
export const UPLOAD_SNIFF_BYTES = IMAGE_SIGNATURE_BYTES;

const IMAGE_MIME_TYPES: Record<DetectedImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

/**
 * Types a browser parses and may execute (script in svg, html, xml): an
 * upload stored or served under one of them is stored XSS on that origin.
 */
const MARKUP_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("latin1");
}

/**
 * Whether a MIME type is one browsers render as markup or run as script.
 */
export function isMarkupMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;

  const type = (mimeType.split(";")[0] ?? "").trim().toLowerCase();

  return MARKUP_MIME_TYPES.has(type) || type.endsWith("+xml");
}

/**
 * Whether a MIME type is a raster image (any `image/*` but svg).
 */
export function isRasterImageMimeType(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
}

/**
 * The MIME type the file's first bytes show, never the client's declared
 * type or file name: raster images (jpeg, png, webp, gif, avif, heic/heif,
 * bmp, tiff, ico), svg, pdf, html and xml. `undefined` when the bytes match
 * none of them.
 */
export function sniffUploadMimeType(buffer: Buffer): string | undefined {
  const image = detectImageFormat(buffer);

  if (image) return IMAGE_MIME_TYPES[image];

  if (ascii(buffer, 4, 8) === "ftyp") {
    const brand = ascii(buffer, 8, 12);

    if (HEIC_BRANDS.has(brand)) return "image/heic";

    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }

  if (ascii(buffer, 0, 2) === "BM" && buffer.length >= 18) {
    if (BMP_HEADER_SIZES.has(buffer.readUInt32LE(14))) return "image/bmp";
  }

  const tiff = ascii(buffer, 0, 4);

  if (tiff === "II*\u0000" || tiff === "MM\u0000*") return "image/tiff";

  if (buffer.length >= 6 && buffer.readUInt32BE(0) === 0x00000100 && buffer.readUInt16LE(4) > 0) {
    return "image/x-icon";
  }

  if (ascii(buffer, 0, 5) === "%PDF-") return "application/pdf";

  const head = buffer
    .subarray(0, UPLOAD_SNIFF_BYTES)
    .toString("utf8")
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();

  if (!head.startsWith("<")) return undefined;

  if (head.includes("<svg")) return "image/svg+xml";

  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body") ||
    head.startsWith("<script") ||
    head.startsWith("<iframe")
  ) {
    return "text/html";
  }

  if (head.startsWith("<?xml")) return "application/xml";

  return undefined;
}
