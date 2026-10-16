import { createHash } from "node:crypto";
import path from "node:path";
import type { StorageDriverContract, StorageDriverName } from "../../storage/types";
import { storage } from "../../storage";
import { storagePath } from "../../utils/paths";
import { HttpError } from "../errors";
import { detectImageFormat, isVariantSourceFormat } from "./detect-image-format";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";
import { loadVariantSource } from "./load-variant-source";

export function remoteVariantDisk(disk?: StorageDriverName): {
  driver: StorageDriverContract;
  root: string;
  cacheRoot: string;
} {
  const driver = disk === undefined ? storage.activeDriver : storage.getDriver(disk);
  const { bucket, endpoint, region } = driver.options;
  return {
    driver,
    root: JSON.stringify([driver.name, bucket, endpoint, region]),
    cacheRoot: storagePath(),
  };
}

/** Object keys are normalized once, without URL decoding, before prefixing. */
export function remoteVariantPath(location: string): string | undefined {
  if (
    !location ||
    location.includes("\0") ||
    location.includes("\\") ||
    path.posix.isAbsolute(location) ||
    path.win32.isAbsolute(location) ||
    /^[A-Za-z]:/.test(location) ||
    location.split("/").includes("..")
  )
    return undefined;
  const normalized = path.posix.normalize(location);
  return normalized === "." ? undefined : normalized;
}

export async function remoteVariantSource(
  location: string,
  disk: ReturnType<typeof remoteVariantDisk>,
  images: ResolvedImageVariantsConfig,
) {
  const relativePath = remoteVariantPath(location);
  if (!relativePath) return undefined;
  let metadata;
  try {
    metadata = await disk.driver.metadata(relativePath);
  } catch (error) {
    const detail = error as {
      code?: string;
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (
      ["ENOENT", "NoSuchKey", "NotFound"].includes(detail.code ?? detail.name ?? "") ||
      detail.$metadata?.httpStatusCode === 404
    )
      return undefined;
    throw error;
  }
  if (metadata.isDirectory) return undefined;
  if (metadata.size > images.maxSourceBytes)
    throw new HttpError(413, "The source image is too large.");
  // The identity includes the effective prefix, including tenant context.
  const sourcePath = disk.driver.applyPrefix(relativePath);
  return {
    relativePath,
    sourcePath,
    async load() {
      const stream = await disk.driver.getStream(relativePath);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > images.maxSourceBytes)
            throw new HttpError(413, "The source image is too large.");
          chunks.push(buffer);
        }
      } finally {
        stream.destroy();
      }
      const buffer = Buffer.concat(chunks);
      const sourceFormat = detectImageFormat(buffer);
      if (!isVariantSourceFormat(sourceFormat))
        throw new HttpError(
          415,
          "Variants are only available for jpeg, png, webp and avif images.",
        );
      const image = await loadVariantSource(buffer, {
        maxSourceBytes: images.maxSourceBytes,
        maxSourcePixels: images.maxSourcePixels,
        expectedFormat: sourceFormat,
      });
      return { image, sourceFormat, generation: createHash("sha256").update(buffer).digest("hex") };
    },
  };
}
