import path from "node:path";
import { getFilesFromDirectory } from "../dev-server/utils";
import { Path } from "../utils/normalized-path";
import { isTestFile } from "../utils/is-test-file";

/**
 * Where `warlock migrate` looks for migration files, relative to `src/app`:
 * any `models/<name>/migrations/` folder at any depth, and a `migrations/`
 * folder directly inside a module.
 */
export const MIGRATION_PATTERNS = ["**/models/*/migrations/*", "*/migrations/*"] as const;

/**
 * Absolute paths of every migration file under the app directory: no
 * duplicates, no test files, stable (sorted) order.
 */
export async function discoverMigrationFiles(appDirectory: string): Promise<string[]> {
  const found = new Set<string>();

  for (const pattern of MIGRATION_PATTERNS) {
    for (const file of await getFilesFromDirectory(appDirectory, pattern)) {
      if (!isTestFile(file)) found.add(file);
    }
  }

  return [...found].sort();
}

/**
 * `*.migration.<ext>` files under the app directory that discovery does not
 * pick up, so `warlock migrate` would silently skip them. Returned as
 * app-directory-relative paths with forward slashes.
 */
export async function findUndiscoveredMigrations(appDirectory: string): Promise<string[]> {
  const discovered = new Set(await discoverMigrationFiles(appDirectory));
  const candidates = await getFilesFromDirectory(
    appDirectory,
    "**/*.migration.{ts,tsx,js,mjs,cjs}",
  );

  return candidates
    .filter((file) => !isTestFile(file) && !discovered.has(file))
    .map((file) => path.relative(Path.normalize(appDirectory), file).replaceAll("\\", "/"))
    .sort();
}
