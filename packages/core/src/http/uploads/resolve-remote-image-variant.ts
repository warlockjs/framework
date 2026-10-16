import { HttpError } from "../errors";
import { uploadsConfig } from "../uploads-config";
import { generateImageVariant } from "./generate-image-variant";
import { retryOnVanishedDirectory, warnIfVariantCacheIsPublic } from "./image-variant-cache";
import { remoteVariantDisk, remoteVariantSource } from "./remote-variant-source";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import type { ResolveImageVariantInput, ResolvedImageVariant } from "./resolve-image-variant";
import { freshImageVariant, trimImageVariantCache } from "./trim-image-variant-cache";
import { variantCacheKey, variantCachePath, variantSourceKey } from "./variant-cache-key";
import { variantGenerations } from "./variant-generations";

/** Cloud sources are read through their driver; derivatives remain in a local cache. */
export async function resolveRemoteImageVariant(
  input: ResolveImageVariantInput,
): Promise<ResolvedImageVariant | undefined> {
  const disk = remoteVariantDisk(input.disk);
  const images = resolveImageVariantsConfig(uploadsConfig("images"), disk.cacheRoot);
  if (!images) throw new HttpError(400, "Image variants are not configured.");
  const variant = Object.prototype.hasOwnProperty.call(images.variants, input.variant)
    ? images.variants[input.variant]
    : undefined;
  if (!variant) throw new HttpError(400, `Unknown variant "${input.variant}".`);
  if (input.format !== undefined && !images.formats.includes(input.format as never))
    throw new HttpError(400, `Format "${input.format}" is not allowed.`);
  const source = await remoteVariantSource(input.path, disk, images);
  if (!source) return undefined;
  // Read bounded bytes on every request: content hashes invalidate even when
  // object metadata is missing or a provider reuses a timestamp.
  const { image, sourceFormat, generation } = await source.load();
  const format = input.format ?? sourceFormat;
  const sourceKey = variantSourceKey(disk.root, source.sourcePath);
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
      await retryOnVanishedDirectory(() =>
        generateImageVariant({ image, variant, format, targetPath: target }),
      );
      // Cloud updates can race an older download. Retain generations here;
      // age/size eviction bounds them without pruning a newer version.
    });
  }
  await trimImageVariantCache(images, target);
  return { absolutePath: target, hash, format, contentType: `image/${format}` };
}
