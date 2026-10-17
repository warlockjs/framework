import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { storage } from "../../storage";
import { storageConfigurations } from "../../storage/config";
import type { StorageDriverName } from "../../storage/types";
import { FakeAssertionError } from "./fake-assertion-error";

/**
 * The env var that carries the fake storage root from the process that
 * created it (the HTTP test server, in `globalSetup`) to the test workers it
 * spawns, so both sides read and write the same files. Like
 * `WARLOCK_TEST_SERVER_PORT`, it is plumbing between the kit's own processes.
 */
export const TEST_STORAGE_ROOT_ENV_KEY = "WARLOCK_TEST_STORAGE_ROOT";

let root: string | undefined;
let ownsRoot = false;
let installed = false;
let wasInitialized = false;

function currentRoot(): string {
  if (!root) {
    throw new FakeAssertionError(
      "storageFake is not installed. It installs by default in the test environment; check `tests.fakes` in src/config/tests.ts, or call storageFake.install().",
    );
  }

  return root;
}

function listFiles(directory: string, base: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);

    return entry.isDirectory()
      ? listFiles(absolute, base)
      : [path.relative(base, absolute).split(path.sep).join("/")];
  });
}

/**
 * Points every configured storage driver — local, S3, R2, Spaces — at a
 * local temporary directory.
 *
 * Installed by default in the test environment: uploads and `storage.put()`
 * calls land on disk under one temp root (a folder per driver name), never in
 * a bucket and never in the app's real `storage/` folder. The root is shared
 * with the HTTP test server, so a file an HTTP request stored is visible to
 * the test that sent it. The process that created the root deletes it on
 * restore.
 *
 * @example
 * await uploadAvatar(user, file);
 *
 * await storageFake.assertExists(`avatars/${user.id}.png`);
 */
export const storageFake = {
  /** Re-register every driver as a local one under the temp root. */
  async install(): Promise<void> {
    if (!installed) {
      wasInitialized = storage.isInitialized;
      installed = true;
    }

    if (!root) {
      const shared = process.env[TEST_STORAGE_ROOT_ENV_KEY];

      if (shared) {
        root = shared;
        ownsRoot = false;
      } else {
        root = mkdtempSync(path.join(os.tmpdir(), "warlock-test-storage-"));
        ownsRoot = true;
        process.env[TEST_STORAGE_ROOT_ENV_KEY] = root;
      }
    }

    await storage.init();

    const fakeRoot = root;

    for (const name of storage.driverNames()) {
      const driverRoot = path.join(fakeRoot, name);

      mkdirSync(driverRoot, { recursive: true });
      storage.register(
        name,
        storageConfigurations.local({ root: driverRoot, urlPrefix: `/test-storage/${name}` }),
      );
    }

    const defaultName = storage.getDefaultName();

    if (defaultName) storage.setDefault(defaultName);
  },

  /** Drop the fake drivers; the real configuration is read again on next use. */
  async restore(): Promise<void> {
    if (!installed) return;

    installed = false;
    storage.reset();

    if (wasInitialized) await storage.init();

    if (root && ownsRoot) {
      rmSync(root, { recursive: true, force: true });

      if (process.env[TEST_STORAGE_ROOT_ENV_KEY] === root) {
        delete process.env[TEST_STORAGE_ROOT_ENV_KEY];
      }
    }

    root = undefined;
    ownsRoot = false;
  },

  isInstalled(): boolean {
    return installed;
  },

  /** The temp directory every fake driver lives under. */
  root(): string {
    return currentRoot();
  },

  /** Every stored file, as `<driver>/<path>`, sorted. */
  files(driver?: StorageDriverName): string[] {
    const base = currentRoot();
    const directory = driver ? path.join(base, driver) : base;

    return listFiles(directory, directory).sort();
  },

  /** Assert a file exists, on the default driver unless `driver` is given. */
  async assertExists(location: string, driver?: StorageDriverName): Promise<void> {
    currentRoot();

    const target = driver ? storage.use(driver) : storage;

    if (!(await target.exists(location))) {
      throw new FakeAssertionError(
        `Expected ${JSON.stringify(location)} to be stored${driver ? ` on "${driver}"` : ""}. Stored files: ${JSON.stringify(storageFake.files())}.`,
      );
    }
  },

  /** Assert a file does not exist, on the default driver unless `driver` is given. */
  async assertMissing(location: string, driver?: StorageDriverName): Promise<void> {
    currentRoot();

    const target = driver ? storage.use(driver) : storage;

    if (await target.exists(location)) {
      throw new FakeAssertionError(
        `Expected ${JSON.stringify(location)} not to be stored${driver ? ` on "${driver}"` : ""}, but it is.`,
      );
    }
  },
};
