import { stat as statPromise } from "node:fs/promises";
import { statSync } from "node:fs";

/**
 * Get last-modified time of a path. Returns a Date.
 *
 * @throws if the path does not exist.
 */
export async function lastModifiedAsync(path: string): Promise<Date> {
  return (await statPromise(path)).mtime;
}

export function lastModified(path: string): Date {
  return statSync(path).mtime;
}

/**
 * Return raw fs.Stats for a path.
 */
export async function statsAsync(path: string) {
  return statPromise(path);
}

export function stats(path: string) {
  return statSync(path);
}
