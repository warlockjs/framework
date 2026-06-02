import { ensureDirectoryAsync } from "@warlock.js/fs";
import glob from "fast-glob";
import { srcPath, warlockPath } from "../utils";
import { Path } from "./path";

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
  const files = await glob(`${Path.normalize(directoryPath)}/${pattern}`, { absolute: true });
  return files.map(file => Path.normalize(file));
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
