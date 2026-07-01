import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

/**
 * Read a file as UTF-8 text.
 */
export async function getFileAsync(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

export function getFile(path: string): string {
  return readFileSync(path, "utf-8");
}

/**
 * Read a JSON file and parse it.
 *
 * @throws if the file does not exist or contains invalid JSON.
 */
export async function getJsonFileAsync<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await getFileAsync(path)) as T;
}

export function getJsonFile<T = unknown>(path: string): T {
  return JSON.parse(getFile(path)) as T;
}
