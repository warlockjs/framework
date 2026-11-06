import { ensureDirectoryAsync } from "@warlock.js/fs";
import glob from "fast-glob";
import { srcPath, warlockPath } from "../utils";
import { Path } from "../utils/normalized-path";

/**
 * Ensure the .warlock/ directory exists. Used by the loader-hook
 * registration which writes its bundled hook file into this directory.
 */
export async function ensureWarlockDirectory() {
  await ensureDirectoryAsync(warlockPath());
}

/**
 * Glob the project's `src/` directory for `.ts`/`.tsx` files. Returns
 * normalised absolute paths.
 */
export async function getFilesFromDirectory(directoryPath = srcPath(), pattern = "**/*.{ts,tsx}") {
  // Glob relative to the directory instead of prefixing the pattern with its
  // absolute path: the prefix is then never parsed as glob syntax, so a project
  // path with dot-directories or glob characters (`[`, `(`, `{`) cannot change
  // what matches.
  const files = await glob(pattern, { cwd: Path.normalize(directoryPath), absolute: true });
  return files.map((file) => Path.normalize(file));
}

export async function getCertainFilesFromDirectory(directoryPath: string, filesNames: string[]) {
  const pattern = filesNames.length === 1 ? filesNames[0] : `(${filesNames.join("|")})`;
  return getFilesFromDirectory(directoryPath, pattern + ".{ts,tsx}");
}

export function areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
  if (set1.size !== set2.size) return false;
  for (const item of set1) {
    if (!set2.has(item)) return false;
  }
  return true;
}
