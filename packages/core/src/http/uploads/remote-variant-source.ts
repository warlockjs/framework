import { createHash } from "node:crypto";
import path from "node:path";
import type { StorageDriverContract, StorageDriverName } from "../../storage/types";
import { storage } from "../../storage";
import { storagePath } from "../../utils/paths";
import { HttpError } from "../errors";
import { detectImageFormat, isVariantSourceFormat } from "./detect-image-format";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";
import { loadVariantSource } from "./load-variant-source";
import type { Image } from "../../image";
import type { VariantSourceFormat } from "./image-variant-types";

type LoadedRemoteSource = { image: Image; sourceFormat: VariantSourceFormat; generation: string };
export type RemoteVariantSource = {
  relativePath: string;
  sourcePath: string;
  metadataGeneration?: string;
  load(): Promise<LoadedRemoteSource>;
  release(): void;
};
const activeSources = new Map<string, { references: number; source: RemoteVariantSource }>();

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
): Promise<RemoteVariantSource | undefined> {
  const relativePath = remoteVariantPath(location);
  if (!relativePath) return undefined;
  const objectPath = relativePath;
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
  const metadataGeneration = metadata.etag
    ? createHash("sha256")
        .update(JSON.stringify([metadata.etag, metadata.size, metadata.lastModified?.getTime()]))
        .digest("hex")
    : undefined;
  const activeKey = JSON.stringify([
    disk.root,
    sourcePath,
    metadataGeneration,
    images.maxSourceBytes,
    images.maxSourcePixels,
  ]);
  const existing = activeSources.get(activeKey);
  if (existing) {
    existing.references++;
    return existing.source;
  }
  let loaded: Promise<LoadedRemoteSource> | undefined;
  async function load() {
    const stream = await disk.driver.getStream(objectPath);
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > images.maxSourceBytes)
          throw new HttpError(413, "The source image is too large.");
        chunks.push(bytes);
      }
    } finally {
      stream.destroy();
    }
    const buffer = Buffer.concat(chunks);
    const sourceFormat = detectImageFormat(buffer);
    if (!isVariantSourceFormat(sourceFormat))
      throw new HttpError(415, "Variants are only available for jpeg, png, webp and avif images.");
    const image = await loadVariantSource(buffer, {
      maxSourceBytes: images.maxSourceBytes,
      maxSourcePixels: images.maxSourcePixels,
      expectedFormat: sourceFormat,
    });
    return {
      image,
      sourceFormat,
      generation: metadataGeneration ?? createHash("sha256").update(buffer).digest("hex"),
    };
  }
  const source: RemoteVariantSource = {
    relativePath,
    sourcePath,
    metadataGeneration,
    load: () => (loaded ??= load()),
    release() {
      const active = activeSources.get(activeKey);
      if (active && --active.references === 0) activeSources.delete(activeKey);
    },
  };
  activeSources.set(activeKey, { source, references: 1 });
  return source;
}
