import path from "node:path";
import type { StorageDriverName } from "../../storage/types";
import { purgeImageVariantsOfFile, variantCacheDirectoryFor } from "./image-variant-cache";
import { remoteVariantDisk, remoteVariantPath } from "./remote-variant-source";
import { variantSourceDirectory, variantSourceKey } from "./variant-cache-key";
import { localDiskRoot } from "./local-disk-root";
import {
  purgeVariantCacheEntries,
  variantCacheEntries,
  variantSourceCacheEntries,
} from "./image-variant-cache-entries";

/**
 * Options for {@link purgeImageVariants}
 */
export type PurgeImageVariantsOptions = {
  /**
   * Disk the source lives on; the default disk when omitted
   */
  disk?: StorageDriverName;
};

/**
 * Remove cached image derivatives.
 *
 * - With a path: every derivative of that file, in every variant and format.
 *   The file itself is untouched and does not need to exist.
 * - Without a path: the whole derivative cache of the disk. When
 *   `uploads.images.cacheDirectory` is set, that directory is shared by every
 *   local disk, so this clears all of them.
 *
 * Only recognized derivative, source-manifest and temporary files in the
 * generated cache layout are removed. The cache root, directories, unrelated
 * files and symlinks stay in place. Use a dedicated folder for derivatives.
 *
 * Deleting or moving a file through local storage (`storage.delete`,
 * `deleteMany`, `move`) already purges its derivatives; call this for files
 * removed some other way.
 *
 * @throws ImageVariantsConfigError when the cache equals or contains any
 * configured local disk root, including through a symlink
 * @returns `true` when something was removed
 */
export async function purgeImageVariants(
  relativePath?: string,
  options: PurgeImageVariantsOptions = {},
): Promise<boolean> {
  const diskRoot = localDiskRoot(options.disk);

  if (!diskRoot) {
    const disk = remoteVariantDisk(options.disk);
    const location = relativePath === undefined ? undefined : remoteVariantPath(relativePath);
    if (relativePath !== undefined && location === undefined) return false;
    const cache = variantCacheDirectoryFor(disk.cacheRoot);
    return purgeVariantCacheEntries(
      location === undefined
        ? variantCacheEntries(cache)
        : variantSourceCacheEntries(
            variantSourceDirectory(
              cache,
              variantSourceKey(disk.root, disk.driver.applyPrefix(location)),
            ),
          ),
    );
  }

  if (relativePath === undefined) {
    return purgeVariantCacheEntries(variantCacheEntries(variantCacheDirectoryFor(diskRoot)));
  }

  const location = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  return purgeImageVariantsOfFile(diskRoot, path.resolve(diskRoot, location));
}
