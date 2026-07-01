import { cp, copyFile as copyFilePromise, mkdir } from "node:fs/promises";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Copy a single file. Creates the destination's parent directory if needed.
 */
export async function copyFileAsync(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFilePromise(source, destination);
}

export function copyFile(source: string, destination: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

/**
 * Recursively copy a directory.
 */
export async function copyDirectoryAsync(source: string, destination: string): Promise<void> {
  await cp(source, destination, { recursive: true });
}

export function copyDirectory(source: string, destination: string): void {
  cpSync(source, destination, { recursive: true });
}
