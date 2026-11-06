import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type StaleTypings = {
  /** Why the typings are out of date, in one sentence. */
  reason: string;
};

const SOURCE_FILE = /\.(ts|tsx|json)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".warlock", "dist"]);

/** Newest modification time under `directory` (0 when it has no files). */
function newestModification(directory: string, accept: (file: string) => boolean): number {
  let newest = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        newest = Math.max(newest, newestModification(full, accept));
      }
    } else if (entry.isFile() && accept(entry.name)) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }

  return newest;
}

/**
 * Whether the generated typings (`.warlock/typings`) are older than the app's
 * sources. Route paths, translation keys and config types are generated from
 * source, so a page, a locale file or a config added after the last
 * `warlock generate.typings` leaves the compiler reporting errors that
 * regenerating would remove.
 *
 * Only a Warlock app is judged (it has `src/config` or `warlock.config.ts`);
 * any other TypeScript project returns `undefined`.
 *
 * @returns `undefined` when the typings are current or the project does not generate any.
 */
export function detectStaleTypings(cwd: string): StaleTypings | undefined {
  const sourceRoot = path.join(cwd, "src");
  const isWarlockApp =
    existsSync(path.join(sourceRoot, "config")) || existsSync(path.join(cwd, "warlock.config.ts"));

  if (!isWarlockApp || !existsSync(sourceRoot)) return undefined;

  const typingsRoot = path.join(cwd, ".warlock", "typings");
  const generatedAt = existsSync(typingsRoot) ? newestModification(typingsRoot, () => true) : 0;

  if (generatedAt === 0) return { reason: "no typings have been generated yet" };

  const changedAt = newestModification(sourceRoot, (name) => SOURCE_FILE.test(name));

  if (changedAt > generatedAt) {
    return { reason: "source files changed after the typings were generated" };
  }

  return undefined;
}
