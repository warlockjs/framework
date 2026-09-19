import fs from "node:fs/promises";
import { HttpError } from "../errors";
import {
  detectImageFormat,
  IMAGE_SIGNATURE_BYTES,
  isVariantSourceFormat,
} from "./detect-image-format";
import type { ResolvedImageVariantsConfig, VariantSourceFormat } from "./image-variant-types";
import { readFileHead } from "./read-file-head";
import { resolveUploadPath, type ResolvedUploadPath } from "./resolve-upload-path";

/**
 * A request path resolved to a usable variant source
 */
export type VariantCandidate = {
  source: ResolvedUploadPath;
  stats: { size: number; mtimeMs: number };
  sourceFormat: VariantSourceFormat;
};

/**
 * Resolve a path to a variant source, applying the guards both the on-demand
 * route and the `generateImageVariants` ingest helper need: containment
 * (via `resolveUploadPath`), the byte-size limit, and the source format,
 * detected from magic bytes rather than the file extension.
 *
 * @returns `undefined` when the path does not resolve to a file inside the
 * storage root — the caller answers 404, the same as a missing file, so the
 * response is no existence oracle
 * @throws HttpError(413) when the source is over `images.maxSourceBytes`
 * @throws HttpError(415) when the source is not jpeg, png, webp or avif
 */
export async function resolveVariantCandidate(
  wildcard: unknown,
  storageRoot: string,
  images: ResolvedImageVariantsConfig,
): Promise<VariantCandidate | undefined> {
  const source = await resolveUploadPath(wildcard, storageRoot, [images.cacheDirectory]);

  if (!source) return undefined;

  const stats = await fs.stat(source.absolutePath);

  if (stats.size > images.maxSourceBytes) {
    throw new HttpError(413, "The source image is too large.");
  }

  const sourceFormat = detectImageFormat(
    await readFileHead(source.absolutePath, IMAGE_SIGNATURE_BYTES),
  );

  if (!isVariantSourceFormat(sourceFormat)) {
    throw new HttpError(415, "Variants are only available for jpeg, png, webp and avif images.");
  }

  return {
    source,
    stats: { size: stats.size, mtimeMs: stats.mtimeMs },
    sourceFormat,
  };
}
