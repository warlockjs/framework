import { atomicWriteAsync } from "@warlock.js/fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../errors";
import { uploadsConfig } from "../uploads-config";
import { isVariantSourceFormat } from "./detect-image-format";
import { generateImageVariant } from "./generate-image-variant";
import { retryOnVanishedDirectory, warnIfVariantCacheIsPublic } from "./image-variant-cache";
import type { ResolvedImageVariantsConfig, VariantOutputFormat } from "./image-variant-types";
import {
  remoteVariantDisk,
  remoteVariantSource,
  type RemoteVariantSource,
} from "./remote-variant-source";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import type { ResolveImageVariantInput, ResolvedImageVariant } from "./resolve-image-variant";
import { freshImageVariant, scheduleImageVariantCacheTrim } from "./trim-image-variant-cache";
import {
  variantCacheKey,
  variantCachePath,
  variantSourceDirectory,
  variantSourceKey,
} from "./variant-cache-key";
import { variantGenerations } from "./variant-generations";

/** Cloud sources are read through their driver; derivatives remain in a local cache. */
export async function resolveRemoteImageVariant(
  input: ResolveImageVariantInput,
): Promise<ResolvedImageVariant | undefined> {
  const disk = remoteVariantDisk(input.disk);
  const images = resolveImageVariantsConfig(uploadsConfig("images"), disk.cacheRoot);
  if (!images) throw new HttpError(400, "Image variants are not configured.");
  if (!Object.prototype.hasOwnProperty.call(images.variants, input.variant))
    throw new HttpError(400, `Unknown variant "${input.variant}".`);
  if (input.format !== undefined && !images.formats.includes(input.format as never))
    throw new HttpError(400, `Format "${input.format}" is not allowed.`);
  const source = await remoteVariantSource(input.path, disk, images);
  if (!source) return undefined;
  try {
    return await renderRemoteImageVariant(input, disk, images, source);
  } finally {
    source.release();
  }
}

/** Ingest rendering reuses one source handle and its memoized bounded download. */
export async function renderRemoteImageVariant(
  input: ResolveImageVariantInput,
  disk: ReturnType<typeof remoteVariantDisk>,
  images: ResolvedImageVariantsConfig,
  source: RemoteVariantSource,
): Promise<ResolvedImageVariant> {
  const variant = Object.prototype.hasOwnProperty.call(images.variants, input.variant)
    ? images.variants[input.variant]
    : undefined;
  if (!variant) throw new HttpError(400, `Unknown variant "${input.variant}".`);
  if (input.format !== undefined && !images.formats.includes(input.format as never))
    throw new HttpError(400, `Format "${input.format}" is not allowed.`);
  const generation = source.metadataGeneration ?? (await source.load()).generation;
  const sourceKey = variantSourceKey(disk.root, source.sourcePath);
  const manifestPath = path.join(
    variantSourceDirectory(images.cacheDirectory, sourceKey),
    generation,
    "source.json",
  );
  let format: VariantOutputFormat | undefined = input.format;
  if (!format) {
    try {
      const saved: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const savedFormat = (saved as { format?: unknown } | null)?.format;
      if (isVariantSourceFormat(savedFormat as never)) format = savedFormat as VariantOutputFormat;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    format ??= (await source.load()).sourceFormat;
  }
  const hash = variantCacheKey({
    relativePath: JSON.stringify([disk.root, source.sourcePath, generation]),
    sourceSize: 0,
    sourceMtimeMs: 0,
    variant,
    format,
  });
  const target = variantCachePath(images.cacheDirectory, { sourceKey, generation }, hash, format);
  warnIfVariantCacheIsPublic(images.cacheDirectory);
  if (!(await freshImageVariant(target, images.maxCacheAge))) {
    await variantGenerations.run(target, async () => {
      if (await freshImageVariant(target, images.maxCacheAge)) return;
      const loaded = await source.load();
      await retryOnVanishedDirectory(async () => {
        await generateImageVariant({
          image: loaded.image.clone(),
          variant,
          format,
          targetPath: target,
        });
        await atomicWriteAsync(manifestPath, JSON.stringify({ format: loaded.sourceFormat }));
      });
      scheduleImageVariantCacheTrim(images, target);
      // Retain other generations: an older concurrent download must not prune
      // a newer object's derivatives. Background eviction reclaims them.
    });
  }
  return { absolutePath: target, hash, format, contentType: `image/${format}` };
}
