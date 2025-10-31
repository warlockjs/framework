import { directoryExistsAsync, fileExistsAsync } from "@mongez/fs";
import fs from "fs/promises";
import path from "path";
import { httpLog } from "../starters/serve-log";
import { warlockPath } from "../utils";

const log = httpLog;

type CleanStaleResult = {
  needsFullBuild: boolean;
  removedCount?: number;
  checkedCount?: number;
  duration?: number;
};

/**
 * Clean stale cache files by comparing modification times with source files
 * Uses manifest.json as the source of truth for file list
 */
export async function cleanStaleCache(): Promise<CleanStaleResult> {
  const startTime = Date.now();

  // Check if .warlock directory exists
  if (!(await directoryExistsAsync(warlockPath()))) {
    return { needsFullBuild: true };
  }

  // Check if .cache directory exists
  const cacheDir = warlockPath(".cache");
  if (!(await directoryExistsAsync(cacheDir))) {
    return { needsFullBuild: true };
  }

  // Load manifest
  const manifestPath = warlockPath("manifest.json");
  if (!(await fileExistsAsync(manifestPath))) {
    return { needsFullBuild: true };
  }

  let manifest: {
    files: Array<{ import: string; path: string; fullPath: string }>;
  };

  try {
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    log.warn(
      "cache",
      "scan",
      `Failed to parse manifest.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { needsFullBuild: true };
  }

  const files = manifest.files || [];
  let removedCount = 0;
  let checkedCount = 0;

  // Iterate through manifest files
  for (const fileInfo of files) {
    checkedCount++;
    const sourcePath = fileInfo.fullPath; // Full path from manifest
    const relativePath = fileInfo.path; // Relative path for logging

    // Calculate cache filename the same way warlock-loader.mjs does
    // Convert full path to relative from cwd, then replace / with -
    const relativeFromCwd = path
      .relative(process.cwd(), sourcePath)
      .replace(/\\/g, "/");
    const cacheFileName = relativeFromCwd
      .replace(/^\./, "")
      .replace(/\//g, "-");
    const cacheFilePath = path.join(cacheDir, cacheFileName);

    try {
      // Check if cache exists
      if (!(await fileExistsAsync(cacheFilePath))) {
        continue; // Cache will be created on first import
      }

      // Check if source file exists
      if (!(await fileExistsAsync(sourcePath))) {
        // Source file doesn't exist anymore - remove cache
        await fs.unlink(cacheFilePath);
        removedCount++;
        continue;
      }

      // Compare modification times
      const [cacheStats, sourceStats] = await Promise.all([
        fs.stat(cacheFilePath),
        fs.stat(sourcePath),
      ]);

      // If source is newer than cache, delete cache
      if (sourceStats.mtimeMs > cacheStats.mtimeMs) {
        await fs.unlink(cacheFilePath);
        removedCount++;
      }
    } catch (error) {
      // Log error but continue processing other files
      log.warn(
        "cache",
        "error",
        `Error checking ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const duration = Date.now() - startTime;

  // Only log if we actually did work
  if (removedCount > 0) {
    log.success(
      "cache",
      "clean",
      `Removed ${removedCount} stale cache files in ${duration}ms`,
    );
  }

  return { needsFullBuild: false, removedCount, checkedCount, duration };
}
