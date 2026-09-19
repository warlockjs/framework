import fs from "node:fs/promises";
import { Image } from "../../image";
import { storage } from "../../storage";
import { HttpError } from "../errors";
import { uploadsConfig } from "../uploads-config";
import type { ImageVariantDefinition, ImageVariantOutputFormat } from "../uploads-types";
import { generateImageVariant } from "./generate-image-variant";
import type {
  GeneratedImageDescriptor,
  GeneratedImageVariant,
  VariantOutputFormat,
} from "./image-variant-types";
import { loadVariantSource } from "./load-variant-source";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import { resolveVariantCandidate } from "./resolve-variant-candidate";
import { variantCacheKey, variantCachePath } from "./variant-cache-key";
import { variantGenerations } from "./variant-generations";

/**
 * Options for `generateImageVariants`
 */
export type GenerateImageVariantsOptions = {
  /**
   * Limit generation to these variant names, instead of every variant in
   * `uploads.images.variants`.
   */
  variants?: readonly string[];
};

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);

    return true;
  } catch {
    return false;
  }
}

function encodeUploadsPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function variantUrl(src: string, name: string, format?: VariantOutputFormat): string {
  const query = format
    ? `variant=${encodeURIComponent(name)}&format=${format}`
    : `variant=${encodeURIComponent(name)}`;

  return `${src}?${query}`;
}

async function readDerivativeDimensions(
  target: string,
): Promise<{ width: number; height: number }> {
  const derivative = new Image(await fs.readFile(target));
  const { width, height } = await derivative.metadata();

  return { width: width ?? 0, height: height ?? 0 };
}

/**
 * Every distinct format a variant is rendered in: the source format plus
 * whatever `uploads.images.formats` adds, with duplicates dropped so a format
 * that is both the source format and an allowed format is generated once.
 */
function outputFormatsFor(
  sourceFormat: VariantOutputFormat,
  configuredFormats: readonly ImageVariantOutputFormat[],
): VariantOutputFormat[] {
  return [...new Set<VariantOutputFormat>([sourceFormat, ...configuredFormats])];
}

/**
 * Render every configured variant of one uploaded image, right after it is
 * saved.
 *
 * Uses the exact same normalized config (`uploads.images`), cache key and
 * derivative path as `uploadedFileController`, so a variant generated here is
 * already on disk the first time `GET /uploads/<path>?variant=<name>` is
 * requested — no second render. `variantGenerations` (the single-flight used
 * by the route) is reused, so a concurrent request for a variant this call is
 * still generating joins the same run instead of starting a second one.
 *
 * The returned descriptor is plain JSON, safe to store next to the record
 * that owns the image, or to carry through loader data. On local storage the
 * `url`/`urls` already point at `uploadedFileController`; an app serving
 * uploads from object storage or a CDN should not proxy the remote files
 * through this route at all — store the descriptor once generation runs
 * against the same bucket the CDN serves from, or resolve its URLs through a
 * custom `ImageLoader` on the client instead.
 *
 * @param relativePath - path of the saved upload, relative to the storage root
 * @param options.variants - limit generation to these variant names
 * @throws HttpError(400) when `uploads.images` is not configured, or a name
 * in `options.variants` is not declared in `uploads.images.variants`
 * @throws HttpError(404) when `relativePath` does not resolve to a file
 * inside the storage root
 * @throws HttpError(413) when the source is over `maxSourceBytes` or
 * `maxSourcePixels`
 * @throws HttpError(415) when the source is not jpeg, png, webp or avif
 */
export async function generateImageVariants(
  relativePath: string,
  options: GenerateImageVariantsOptions = {},
): Promise<GeneratedImageDescriptor> {
  const storageRoot = storage.root();

  if (!storageRoot || storageRoot === ".") {
    throw new Error("generateImageVariants needs a local storage driver with a root.");
  }

  const images = resolveImageVariantsConfig(uploadsConfig("images"), storageRoot);

  if (!images) {
    throw new HttpError(400, "Image variants are not configured.");
  }

  const names = options.variants ?? Object.keys(images.variants);

  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(images.variants, name)) {
      throw new HttpError(400, `Unknown variant "${name}".`);
    }
  }

  const candidate = await resolveVariantCandidate(relativePath, storageRoot, images);

  if (!candidate) {
    throw new HttpError(404, "File Not Found");
  }

  const { source, stats, sourceFormat } = candidate;

  const image = await loadVariantSource(source.absolutePath, {
    maxSourceBytes: images.maxSourceBytes,
    maxSourcePixels: images.maxSourcePixels,
    expectedFormat: sourceFormat,
  });

  const { width: sourceWidth, height: sourceHeight } = await image.metadata();
  const src = `/uploads/${encodeUploadsPath(source.relativePath)}`;
  const variants: Record<string, GeneratedImageVariant> = {};

  for (const name of names) {
    const variant: ImageVariantDefinition = images.variants[name];
    const formats = outputFormatsFor(sourceFormat, images.formats);
    let dimensions: { width: number; height: number } | undefined;

    for (const format of formats) {
      const hash = variantCacheKey({
        relativePath: source.relativePath,
        sourceSize: stats.size,
        sourceMtimeMs: stats.mtimeMs,
        variant,
        format,
      });
      const target = variantCachePath(images.cacheDirectory, hash, format);

      if (!(await exists(target))) {
        await variantGenerations.run(hash, async () => {
          if (await exists(target)) return;

          await generateImageVariant({ image: image.clone(), variant, format, targetPath: target });
        });
      }

      if (dimensions === undefined) {
        dimensions = await readDerivativeDimensions(target);
      }
    }

    const urls: Partial<Record<ImageVariantOutputFormat, string>> = {};

    for (const format of images.formats) {
      urls[format] = variantUrl(src, name, format);
    }

    variants[name] = {
      width: dimensions?.width ?? variant.width,
      height:
        dimensions?.height ??
        variant.height ??
        Math.round(variant.width * ((sourceHeight ?? 1) / (sourceWidth ?? 1))),
      url: variantUrl(src, name),
      ...(Object.keys(urls).length > 0 ? { urls } : {}),
    };
  }

  return {
    src,
    width: sourceWidth ?? 0,
    height: sourceHeight ?? 0,
    variants,
    ...(images.formats.length > 0 ? { formats: images.formats } : {}),
  };
}
