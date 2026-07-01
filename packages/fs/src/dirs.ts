import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";

/**
 * Ensure a directory exists (recursively creating parents).
 * Idempotent — no error if the directory already exists.
 */
export async function ensureDirectoryAsync(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}
