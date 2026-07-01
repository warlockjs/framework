import { readdir, stat } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * List immediate children of a directory (files + subdirs), returning
 * full paths.
 */
export async function listAsync(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath);
  return entries.map(entry => path.join(directoryPath, entry));
}

export function list(directoryPath: string): string[] {
  return readdirSync(directoryPath).map(entry => path.join(directoryPath, entry));
}

/**
 * List only files (not subdirectories) directly inside a directory.
 */
export async function listFilesAsync(directoryPath: string): Promise<string[]> {
  const entries = await listAsync(directoryPath);
  const checks = await Promise.all(
    entries.map(async entry => ((await stat(entry)).isFile() ? entry : null)),
  );
  return checks.filter((entry): entry is string => entry !== null);
}

export function listFiles(directoryPath: string): string[] {
  return list(directoryPath).filter(entry => statSync(entry).isFile());
}

/**
 * List only subdirectories directly inside a directory.
 */
export async function listDirectoriesAsync(directoryPath: string): Promise<string[]> {
  const entries = await listAsync(directoryPath);
  const checks = await Promise.all(
    entries.map(async entry => ((await stat(entry)).isDirectory() ? entry : null)),
  );
  return checks.filter((entry): entry is string => entry !== null);
}

export function listDirectories(directoryPath: string): string[] {
  return list(directoryPath).filter(entry => statSync(entry).isDirectory());
}
