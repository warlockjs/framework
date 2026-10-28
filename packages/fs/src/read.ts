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
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(await getFileAsync(path)) as T;
    } catch (error) {
      // Windows can briefly refuse to open a file that is being replaced.
      if (attempt >= READ_ATTEMPTS || !isTransientLock(error)) throw error;

      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS * attempt));
    }
  }
}

export function getJsonFile<T = unknown>(path: string): T {
  return JSON.parse(getFile(path)) as T;
}

const READ_ATTEMPTS = 6;
const READ_RETRY_MS = 10;

function isTransientLock(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  return code === "EPERM" || code === "EBUSY";
}
