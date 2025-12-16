import { createDirectoryAsync, directoryExists, removeDirectoryAsync } from "@mongez/fs";
import { srcPath, warlockPath } from "../utils";
import glob from "fast-glob";
import { Path } from "./path";

const directoryPath = warlockPath();

export async function createFreshWarlockDirectory() {
  if (await directoryExists(directoryPath)) {
    await removeDirectoryAsync(directoryPath);
  }

  await createDirectoryAsync(directoryPath + "/cache", { recursive: true });
}

export async function getFilesFromDirectory(directoryPath = srcPath(), pattern = "**/*.{ts,tsx}") {
  const files = await glob(`${Path.normalize(directoryPath)}/${pattern}`, {
    absolute: true, // Return absolute paths
  });

  return files.map((file) => Path.normalize(file));
}

export function warlockCachePath(relativePath: string) {
  return `${warlockPath("cache")}/${relativePath}`;
}

/**
 * Compare two sets for equality
 */
export function areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
  if (set1.size !== set2.size) return false;
  for (const item of set1) {
    if (!set2.has(item)) return false;
  }
  return true;
}
