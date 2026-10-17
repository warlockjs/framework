import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { configuredLocalDiskRoots } from "../../storage/local-disk-roots";
import type { UploadsImagesConfigurations } from "../uploads-types";
import { ImageVariantsConfigError } from "./image-variants-config-error";
import { purgeVariantCacheEntries, variantSourceCacheEntries } from "./image-variant-cache-entries";
import path from "node:path";
import { rootPath } from "../../utils/paths";
import { uploadsConfig } from "../uploads-config";
import { isPathInside, isPathWithin } from "./is-path-inside";
import {
  variantGenerationTag,
  variantSourceDirectory,
  variantSourceKey,
} from "./variant-cache-key";

/*
 * Cache housekeeping for image derivatives. Deliberately free of any
 * import of the storage manager or drivers: the local driver calls into this module when it
 * deletes or moves a file, and storage must not import back into the HTTP
 * layer that already imports storage.
 */

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

function canonicalDirectory(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fsSync.realpathSync(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // ENOTDIR, EACCES, ELOOP, ...: a configuration problem, reported as one.
      throw new ImageVariantsConfigError(
        `uploads.images.cacheDirectory (or a local disk root) could not be resolved: ${resolved} (${code ?? "unknown error"})`,
        { cause: error },
      );
    }
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    // Resolve the nearest existing ancestor too, so a symlink followed by a
    // not-yet-created directory cannot hide an overlap with a future disk root.
    return path.join(canonicalDirectory(parent), path.basename(resolved));
  }
}

/** Most distinct cache/disk-root combinations whose overlap check is remembered. */
const OVERLAP_CHECKS_LIMIT = 64;

/**
 * Overlap check outcomes, keyed by the cache directory, the disk root and
 * every configured local root. A disk registered later changes the key, so
 * it is checked again; the stored error is rethrown for a refused layout.
 */
const overlapChecks = new Map<string, ImageVariantsConfigError | undefined>();

function checkCacheOverlap(directory: string, diskRoot: string): void {
  const roots = [diskRoot, ...configuredLocalDiskRoots()];
  const key = [directory, ...roots].join("\0");
  if (overlapChecks.has(key)) {
    const failure = overlapChecks.get(key);
    if (failure) throw failure;
    return;
  }
  let failure: ImageVariantsConfigError | undefined;
  try {
    const realCache = canonicalDirectory(directory);
    for (const root of roots) {
      if (isPathWithin(canonicalDirectory(root), realCache)) {
        failure = new ImageVariantsConfigError(
          "uploads.images.cacheDirectory must not equal or contain the storage root of any local disk (including symlinks).",
        );
        break;
      }
    }
  } catch (error) {
    // Only configuration errors are remembered; anything else is retried next time.
    if (!(error instanceof ImageVariantsConfigError)) throw error;
    failure = error;
  }
  if (overlapChecks.size >= OVERLAP_CHECKS_LIMIT) {
    const oldest = overlapChecks.keys().next();
    if (!oldest.done) overlapChecks.delete(oldest.value);
  }
  overlapChecks.set(key, failure);
  if (failure) throw failure;
}

/**
 * Forget remembered cache overlap checks, so the next check resolves every
 * path again (tests). Changes to the configured disks are detected without it;
 * a directory replaced by a symlink at runtime is not.
 */
export function resetVariantCacheOverlapChecks(): void {
  overlapChecks.clear();
}

/**
 * The derivative cache directory for a local disk: `uploads.images.cacheDirectory`
 * when the app sets one (shared by every disk; derivatives are keyed by the
 * disk's real root, so they never collide), otherwise
 * `<diskRoot>/.cache/image-variants`. The same rule as
 * `resolveImageVariantsConfig`. Refuses any cache that equals or contains
 * any configured local root, resolving symlinks before comparison. The
 * outcome is remembered per cache, disk root and configured local roots, so
 * repeated requests do not resolve the same paths again.
 *
 * @throws ImageVariantsConfigError when a cache overlaps a local disk root, or
 * when the cache or a root cannot be resolved (for example `ENOTDIR`, `EACCES`)
 */
export function variantCacheDirectoryFor(
  diskRoot: string,
  images: Pick<UploadsImagesConfigurations, "cacheDirectory"> | undefined = uploadsConfig("images"),
): string {
  const configured = images?.cacheDirectory;
  const directory = configured
    ? path.resolve(configured)
    : path.join(path.resolve(diskRoot), ".cache", "image-variants");
  checkCacheOverlap(directory, diskRoot);
  return directory;
}

/**
 * The directory holding every derivative of one file on a local disk, or
 * `undefined` when the file is not inside the disk root. The file does not
 * need to exist any more: only its parent directory is resolved through
 * symlinks, exactly as `resolveUploadPath` resolved it when the derivative
 * was made.
 */
export async function variantSourceDirectoryForFile(
  diskRoot: string,
  absolutePath: string,
): Promise<string | undefined> {
  const realRoot = await realpathOrSelf(path.resolve(diskRoot));
  const realParent = await realpathOrSelf(path.dirname(path.resolve(absolutePath)));
  const realPath = path.join(realParent, path.basename(absolutePath));

  if (!isPathInside(realPath, realRoot)) return undefined;

  const relativePath = path.relative(realRoot, realPath).split(path.sep).join("/");

  return variantSourceDirectory(
    variantCacheDirectoryFor(diskRoot),
    variantSourceKey(realRoot, relativePath),
  );
}

/**
 * Remove every cached derivative of one file on a local disk.
 *
 * @returns `true` when recognized cache files were removed
 */
export async function purgeImageVariantsOfFile(
  diskRoot: string,
  absolutePath: string,
): Promise<boolean> {
  const directory = await variantSourceDirectoryForFile(diskRoot, absolutePath);

  if (!directory) return false;

  return purgeVariantCacheEntries(variantSourceCacheEntries(directory));
}

/**
 * Remove derivatives made from older versions of a source (a different size
 * or mtime), keeping only the `keep` generation. Called after a derivative of
 * the current version has been written, so a source rewritten in place does
 * not leave its old derivatives behind. Only recognized cache files in
 * generation-shaped directories are removed; unrelated entries and all
 * directories and symlinks stay in place.
 */
export async function pruneStaleVariantGenerations(
  sourceDirectory: string,
  keep: string,
): Promise<void> {
  await purgeVariantCacheEntries(variantSourceCacheEntries(sourceDirectory, keep));
}

/**
 * {@link pruneStaleVariantGenerations}, but only while `keep` is still the
 * source's current generation.
 *
 * A request that read the source before it was rewritten renders an old
 * generation; if it pruned afterwards it would delete the derivatives of the
 * newer version another request had just written. Re-reading the source's
 * size and mtime right before pruning keeps a stale request from doing that.
 */
export async function pruneStaleVariantGenerationsIfCurrent(
  sourceAbsolutePath: string,
  sourceDirectory: string,
  keep: string,
): Promise<void> {
  let current: string;

  try {
    const stats = await fs.stat(sourceAbsolutePath);
    current = variantGenerationTag(stats.size, stats.mtimeMs);
  } catch {
    // the source is gone; its derivatives are purged by the delete itself
    return;
  }

  if (current !== keep) return;

  await pruneStaleVariantGenerations(sourceDirectory, keep);
}

/**
 * True for "no such file or directory"
 */
export function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Run a derivative write, once more if it fails because its directory
 * vanished: a concurrent request for a newer version of the source may prune
 * the generation directory between `mkdir` and the atomic rename.
 */
export async function retryOnVanishedDirectory(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!isMissingFileError(error)) throw error;

    await write();
  }
}

let warnedPublicCache = false;

/**
 * Warn once when the derivative cache sits inside the public folder.
 *
 * A configured `uploads.images.cacheDirectory` is shared by every local disk,
 * so derivatives of a private disk land beside public ones. Inside
 * `public/` (or `storage.publicRoot`) they are served to anyone, bypassing
 * whatever guards the private disk's own route. The paths are hashes, but
 * they are derived from the disk root and the file path, which are not
 * secret.
 */
export function warnIfVariantCacheIsPublic(cacheDirectory: string): void {
  if (warnedPublicCache) return;

  const configured = config.get("storage.publicRoot", rootPath("public")) as unknown;
  const publicRoots = (Array.isArray(configured) ? configured : [configured])
    .filter((root): root is string => typeof root === "string" && root.length > 0)
    .map((root) => path.resolve(root));
  const resolved = path.resolve(cacheDirectory);

  if (!publicRoots.some((root) => resolved === root || isPathInside(resolved, root))) return;

  warnedPublicCache = true;
  log.warn(
    "uploads",
    "image-variants",
    `The image variant cache (${resolved}) is inside the public folder, so every cached derivative, private disks included, is publicly served. Move uploads.images.cacheDirectory outside public/.`,
  );
}

/**
 * Forget that the public-cache warning was shown (tests).
 */
export function resetVariantCacheWarnings(): void {
  warnedPublicCache = false;
}
