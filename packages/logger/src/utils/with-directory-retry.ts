import { ensureDirectoryAsync } from "@warlock.js/fs";
import path from "path";

/**
 * Run a file write; when it fails because the directory is gone, recreate the
 * directory and run it once more.
 */
export async function withDirectoryRetry<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    await ensureDirectoryAsync(path.dirname(filePath));

    return await operation();
  }
}
