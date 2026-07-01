import { rm, unlink as unlinkPromise } from "node:fs/promises";
import { rmSync, unlinkSync } from "node:fs";

/**
 * Delete a single file. No error if the file doesn't exist.
 */
export async function unlinkAsync(path: string): Promise<void> {
  try {
    await unlinkPromise(path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function unlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/**
 * Recursively delete a directory and its contents. No error if missing.
 */
export async function removeDirectoryAsync(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function removeDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
