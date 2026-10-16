import fs from "node:fs/promises";
import path from "node:path";
import type { StorageDriverName } from "../../storage/types";
import { purgeImageVariantsOfFile, variantCacheDirectoryFor } from "./image-variant-cache";
import { ImageVariantsConfigError } from "./image-variants-config-error";
import { localDiskRoot } from "./local-disk-root";

/**
 * Options for {@link purgeImageVariants}
 */
export type PurgeImageVariantsOptions = {
  /**
   * Local disk the source lives on; the default disk when omitted
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
 * Deleting or moving a file through local storage (`storage.delete`,
 * `deleteMany`, `move`) already purges its derivatives; call this for files
 * removed some other way.
 *
 * @returns `true` when something was removed
 * @throws ImageVariantsConfigError when the disk is not a local disk
 */
export async function purgeImageVariants(
  relativePath?: string,
  options: PurgeImageVariantsOptions = {},
): Promise<boolean> {
  const diskRoot = localDiskRoot(options.disk);

  if (!diskRoot) {
    throw new ImageVariantsConfigError(
      options.disk === undefined
        ? "purgeImageVariants needs a local storage driver with a root."
        : `purgeImageVariants needs a local disk; "${options.disk}" is not one.`,
    );
  }

  if (relativePath === undefined) {
    const directory = variantCacheDirectoryFor(diskRoot);

    try {
      await fs.access(directory);
    } catch {
      return false;
    }

    await fs.rm(directory, { recursive: true, force: true });

    return true;
  }

  const location = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  return purgeImageVariantsOfFile(diskRoot, path.resolve(diskRoot, location));
}
