import fs from "node:fs/promises";
import type { StorageDriverName } from "../../storage/types";
import { HttpError } from "../errors";
import { uploadsConfig } from "../uploads-config";
import { generateImageVariant } from "./generate-image-variant";
import {
  pruneStaleVariantGenerationsIfCurrent,
  retryOnVanishedDirectory,
  warnIfVariantCacheIsPublic,
} from "./image-variant-cache";
import { resolveRemoteImageVariant } from "./resolve-remote-image-variant";
import type { VariantOutputFormat } from "./image-variant-types";
import { loadVariantSource } from "./load-variant-source";
import { localDiskRoot } from "./local-disk-root";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import { resolveVariantCandidate } from "./resolve-variant-candidate";
import {
  variantCacheKey,
  variantCachePath,
  variantGenerationTag,
  variantSourceDirectory,
  variantSourceKey,
} from "./variant-cache-key";
import { freshImageVariant, scheduleImageVariantCacheTrim } from "./trim-image-variant-cache";
import { variantGenerations } from "./variant-generations";

const CONTENT_TYPES: Record<VariantOutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * What to render: a file on a storage disk and a variant named in
 * `uploads.images.variants`
 */
export type ResolveImageVariantInput = {
  /**
   * Path of the source, relative to the disk root
   */
  path: string;

  /**
   * Variant name from `uploads.images.variants`
   */
  variant: string;

  /**
   * Output format; defaults to the source's own format. Must be the source
   * format or one listed in `uploads.images.formats`.
   */
  format?: VariantOutputFormat;

  /**
   * Disk the source lives on; the default disk when omitted
   */
  disk?: StorageDriverName;
};

/**
 * A derivative on disk, ready to send
 */
export type ResolvedImageVariant = {
  /**
   * Absolute path of the cached derivative
   */
  absolutePath: string;

  /**
   * sha256 of everything the derivative depends on; a strong ETag value
   */
  hash: string;

  format: VariantOutputFormat;

  contentType: string;
};

/**
 * Resolve, and render on a cache miss, one variant of an image on a storage
 * disk. This is what `uploadedFileController` serves; call it from your own
 * route to serve variants of a private disk behind authentication:
 *
 * ```ts
 * const variant = await resolveImageVariant({ disk: "private", path, variant: "thumb" });
 * if (!variant) return response.notFound();
 * return response.sendBuffer(await fs.readFile(variant.absolutePath), {
 *   contentType: variant.contentType,
 * });
 * ```
 *
 * The same guards apply as on the public route: the path must stay inside
 * the disk root and outside the derivative cache, the source must be a
 * jpeg/png/webp/avif within `maxSourceBytes`/`maxSourcePixels`, and only
 * declared variants and formats render. Derivatives are generated once per
 * key, even under concurrent calls, and older versions of a rewritten source
 * are pruned once a new derivative is written.
 *
 * @returns `undefined` when the path does not resolve to a file on the disk
 * @throws HttpError(400) when variants are not configured, or the variant or
 * format is not allowed
 * @throws HttpError(413) when the source is over the configured limits
 * @throws HttpError(415) when the source is not jpeg, png, webp or avif
 */
export async function resolveImageVariant(
  input: ResolveImageVariantInput,
): Promise<ResolvedImageVariant | undefined> {
  const diskRoot = localDiskRoot(input.disk);

  if (!diskRoot) return resolveRemoteImageVariant(input);

  const images = resolveImageVariantsConfig(uploadsConfig("images"), diskRoot);

  if (!images) {
    throw new HttpError(400, "Image variants are not configured.");
  }

  const variant = Object.prototype.hasOwnProperty.call(images.variants, input.variant)
    ? images.variants[input.variant]
    : undefined;

  if (variant === undefined) {
    throw new HttpError(400, `Unknown variant "${input.variant}".`);
  }

  if (input.format !== undefined && !images.formats.includes(input.format as never)) {
    throw new HttpError(400, `Format "${input.format}" is not allowed.`);
  }

  warnIfVariantCacheIsPublic(images.cacheDirectory);

  const candidate = await resolveVariantCandidate(input.path, diskRoot, images);

  if (!candidate) return undefined;

  const { source, stats, sourceFormat } = candidate;
  const format: VariantOutputFormat = input.format ?? sourceFormat;
  const hash = variantCacheKey({
    relativePath: source.relativePath,
    sourceSize: stats.size,
    sourceMtimeMs: stats.mtimeMs,
    variant,
    format,
  });
  const sourceKey = variantSourceKey(source.root, source.relativePath);
  const generation = variantGenerationTag(stats.size, stats.mtimeMs);
  const target = variantCachePath(images.cacheDirectory, { sourceKey, generation }, hash, format);

  if (!(await freshImageVariant(target, images.maxCacheAge))) {
    // Keyed on the target path, which includes the disk's real root: the
    // same file on two disks (a mirror copied with its mtime) has the same
    // `hash`, and joining the other disk's flight would leave this target
    // unwritten.
    await variantGenerations.run(target, async () => {
      if (await freshImageVariant(target, images.maxCacheAge)) return;

      const image = await loadVariantSource(source.absolutePath, {
        maxSourceBytes: images.maxSourceBytes,
        maxSourcePixels: images.maxSourcePixels,
        expectedFormat: sourceFormat,
      });

      await retryOnVanishedDirectory(() =>
        generateImageVariant({ image: image.clone(), variant, format, targetPath: target }),
      );
      scheduleImageVariantCacheTrim(images, target);
      await pruneStaleVariantGenerationsIfCurrent(
        source.absolutePath,
        variantSourceDirectory(images.cacheDirectory, sourceKey),
        generation,
      );
    });
  }

  return { absolutePath: target, hash, format, contentType: CONTENT_TYPES[format] };
}
