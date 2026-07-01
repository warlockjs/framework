import { access, stat } from "node:fs/promises";
import { accessSync, statSync } from "node:fs";

/**
 * Check whether a path exists, REGARDLESS of type — resolves `true` for both
 * files and directories, `false` only when nothing is there (ENOENT).
 *
 * Pick the right check for the job:
 *   - `pathExistsAsync`      — anything at this path (file OR directory).
 *   - `fileExistsAsync`      — exists AND is a regular file.
 *   - `directoryExistsAsync` — exists AND is a directory.
 *
 * @example
 * if (await pathExistsAsync("/var/data")) {
 *   // something is there — could be a file or a folder
 * }
 */
export async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function pathExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists AND is a regular file. Resolves `false` for a
 * directory — use `directoryExistsAsync` for folders, or `pathExistsAsync`
 * when the type does not matter.
 *
 * @example
 * if (await fileExistsAsync("/etc/config.json")) {
 *   const raw = await readFile("/etc/config.json", "utf8");
 * }
 */
export async function fileExistsAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists AND is a directory. Resolves `false` for a
 * regular file — use `fileExistsAsync` for files, or `pathExistsAsync` when
 * the type does not matter.
 *
 * @example
 * if (await directoryExistsAsync("/var/uploads")) {
 *   const entries = await readdir("/var/uploads");
 * }
 */
export async function directoryExistsAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
