import { storage } from "../../storage";
import type { StorageDriverName } from "../../storage/types";

/**
 * Root directory of a local storage disk, or `undefined` when the disk is not
 * local (object storage has no directory to serve or cache from).
 *
 * Without a name this is the default disk, read through `storage.root()` as
 * `uploadedFileController` always has.
 */
export function localDiskRoot(disk?: StorageDriverName): string | undefined {
  if (disk === undefined) {
    const root = storage.root();

    return root && root !== "." ? root : undefined;
  }

  const driver = storage.getDriver(disk) as { name?: string; getRoot?: () => string };

  if (driver.name !== "local" || typeof driver.getRoot !== "function") return undefined;

  return driver.getRoot();
}
