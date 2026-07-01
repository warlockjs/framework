import { rename as renamePromise } from "node:fs/promises";
import { renameSync } from "node:fs";

/**
 * Rename / move a file or directory.
 */
export async function renameFileAsync(from: string, to: string): Promise<void> {
  await renamePromise(from, to);
}

export function renameFile(from: string, to: string): void {
  renameSync(from, to);
}
