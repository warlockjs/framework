import { createHash } from "node:crypto";
import path from "node:path";
import type { ImageVariantDefinition } from "../uploads-types";
import type { VariantOutputFormat } from "./image-variant-types";

/**
 * Everything a derivative depends on
 */
export type VariantCacheKeyInput = {
  relativePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  variant: ImageVariantDefinition;
  format: VariantOutputFormat;
};

/**
 * JSON of the variant with its keys sorted, so key order in the app config
 * never changes the hash
 */
function normalizedVariantJson(variant: ImageVariantDefinition): string {
  const sorted = Object.fromEntries(
    Object.entries(variant)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  return JSON.stringify(sorted);
}

/**
 * The sha256 cache key of a derivative.
 *
 * The source size and mtime are part of the key, so rewriting the source moves
 * every request to a new key and a fresh derivative. The parts are hashed as a
 * JSON array, so no two different inputs can concatenate to the same string.
 */
export function variantCacheKey(input: VariantCacheKeyInput): string {
  const material = JSON.stringify([
    input.relativePath,
    input.sourceSize,
    input.sourceMtimeMs,
    normalizedVariantJson(input.variant),
    input.format,
  ]);

  return createHash("sha256").update(material).digest("hex");
}

/**
 * File extension of a derivative
 */
export function variantExtension(format: VariantOutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * Where a derivative lives: `<cacheDirectory>/<first 2 hex>/<hash>.<ext>`
 */
export function variantCachePath(
  cacheDirectory: string,
  hash: string,
  format: VariantOutputFormat,
): string {
  return path.join(cacheDirectory, hash.slice(0, 2), `${hash}.${variantExtension(format)}`);
}
