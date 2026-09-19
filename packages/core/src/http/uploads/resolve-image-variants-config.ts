import path from "node:path";
import type {
  ImageVariantDefinition,
  ImageVariantFit,
  ImageVariantOutputFormat,
  UploadsImagesConfigurations,
} from "../uploads-types";
import { ImageVariantsConfigError } from "./image-variants-config-error";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";

/**
 * Largest width or height a variant may declare
 */
export const MAX_VARIANT_DIMENSION = 8192;

/**
 * Default `maxSourceBytes`: 25 MB
 */
export const DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Default `maxSourcePixels`
 */
export const DEFAULT_MAX_SOURCE_PIXELS = 40_000_000;

const FITS: readonly ImageVariantFit[] = ["cover", "contain", "inside"];

const OUTPUT_FORMATS: readonly ImageVariantOutputFormat[] = ["avif", "webp"];

const VARIANT_NAME = /^[A-Za-z0-9_-]+$/;

function isPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

function resolveVariant(name: string, raw: unknown): ImageVariantDefinition {
  const key = `uploads.images.variants.${name}`;

  if (!VARIANT_NAME.test(name)) {
    throw new ImageVariantsConfigError(
      `${key}: a variant name may only use letters, digits, "-" and "_".`,
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new ImageVariantsConfigError(`${key} must be an object with a width.`);
  }

  const { width, height, fit, quality } = raw as Record<string, unknown>;

  if (!isPositiveInteger(width, MAX_VARIANT_DIMENSION)) {
    throw new ImageVariantsConfigError(
      `${key}.width must be an integer from 1 to ${MAX_VARIANT_DIMENSION}, got ${JSON.stringify(width)}.`,
    );
  }

  const variant: ImageVariantDefinition = { width };

  if (height !== undefined) {
    if (!isPositiveInteger(height, MAX_VARIANT_DIMENSION)) {
      throw new ImageVariantsConfigError(
        `${key}.height must be an integer from 1 to ${MAX_VARIANT_DIMENSION}, got ${JSON.stringify(height)}.`,
      );
    }

    variant.height = height;
  }

  if (fit !== undefined) {
    if (!FITS.includes(fit as ImageVariantFit)) {
      throw new ImageVariantsConfigError(
        `${key}.fit must be one of ${FITS.join(", ")}, got ${JSON.stringify(fit)}.`,
      );
    }

    variant.fit = fit as ImageVariantFit;
  }

  if (quality !== undefined) {
    if (!isPositiveInteger(quality, 100)) {
      throw new ImageVariantsConfigError(
        `${key}.quality must be an integer from 1 to 100, got ${JSON.stringify(quality)}.`,
      );
    }

    variant.quality = quality;
  }

  return variant;
}

function resolveFormats(raw: unknown): readonly ImageVariantOutputFormat[] {
  if (raw === undefined) return [];

  if (!Array.isArray(raw)) {
    throw new ImageVariantsConfigError(`uploads.images.formats must be an array.`);
  }

  for (const format of raw) {
    if (!OUTPUT_FORMATS.includes(format)) {
      throw new ImageVariantsConfigError(
        `uploads.images.formats may only contain ${OUTPUT_FORMATS.join(", ")}, got ${JSON.stringify(format)}.`,
      );
    }
  }

  return [...new Set(raw as ImageVariantOutputFormat[])];
}

function resolveLimit(name: string, raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;

  if (!isPositiveInteger(raw)) {
    throw new ImageVariantsConfigError(
      `uploads.images.${name} must be a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }

  return raw;
}

/**
 * Validate the `uploads.images` config and apply its defaults.
 *
 * Every variant is copied field by field, so an unknown key in the config can
 * never reach sharp, and the result is what the cache key is computed from.
 *
 * @param images - the raw `uploads.images` value
 * @param storageRoot - the local storage root, base of the default cache directory
 * @returns the resolved config, or `undefined` when variants are not configured
 * @throws ImageVariantsConfigError when any value is out of bounds
 */
export function resolveImageVariantsConfig(
  images: UploadsImagesConfigurations | undefined,
  storageRoot: string,
): ResolvedImageVariantsConfig | undefined {
  if (images === undefined || images === null) return undefined;

  if (typeof images !== "object") {
    throw new ImageVariantsConfigError("uploads.images must be an object.");
  }

  const rawVariants = (images as { variants?: unknown }).variants;

  if (!rawVariants || typeof rawVariants !== "object" || Object.keys(rawVariants).length === 0) {
    throw new ImageVariantsConfigError(
      "uploads.images.variants must declare at least one variant.",
    );
  }

  const variants: Record<string, ImageVariantDefinition> = {};

  for (const [name, raw] of Object.entries(rawVariants)) {
    variants[name] = resolveVariant(name, raw);
  }

  const cacheDirectory = images.cacheDirectory
    ? path.resolve(images.cacheDirectory)
    : path.join(storageRoot, ".cache", "image-variants");

  return {
    variants,
    formats: resolveFormats(images.formats),
    maxSourceBytes: resolveLimit("maxSourceBytes", images.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES),
    maxSourcePixels: resolveLimit(
      "maxSourcePixels",
      images.maxSourcePixels,
      DEFAULT_MAX_SOURCE_PIXELS,
    ),
    cacheDirectory,
  };
}
