import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Image } from "../../image";
import type { ImageVariantDefinition } from "../uploads-types";
import type { VariantOutputFormat } from "./image-variant-types";

/**
 * Inputs of one derivative generation
 */
export type GenerateImageVariantOptions = {
  image: Image;
  variant: ImageVariantDefinition;
  format: VariantOutputFormat;
  targetPath: string;
};

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);

    return true;
  } catch {
    return false;
  }
}

/**
 * Render a derivative and write it atomically.
 *
 * The image is written to a short `.t-<random>.tmp` file beside the target and then renamed onto the
 * target, so a reader sees no file or a complete one, never a partial one. On
 * any failure the temp file is removed before the error is rethrown.
 */
export async function generateImageVariant({
  image,
  variant,
  format,
  targetPath,
}: GenerateImageVariantOptions): Promise<void> {
  image.resize({
    width: variant.width,
    height: variant.height,
    fit: variant.fit,
    withoutEnlargement: variant.enlarge !== true,
  });
  image.format(format);

  if (variant.quality !== undefined) {
    image.quality(variant.quality);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  // A short name: sharp (libvips) cannot open a path over 260 characters on Windows, and the cache
  // directory is already about 100 characters deeper than its root.
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.t-${randomBytes(8).toString("hex")}.tmp`,
  );

  try {
    await image.save(temporaryPath);

    try {
      await fs.rename(temporaryPath, targetPath);
    } catch (error) {
      // Another process won the race and its file is being read (win32 refuses
      // to replace an open file). Same key, same bytes: theirs will do.
      if (!(await fileExists(targetPath))) throw error;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}
