import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteAsync } from "./atomic";

/**
 * Write a UTF-8 string to disk, creating any missing parent directories.
 */
export async function putFileAsync(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export function putFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Write a JSON-serialisable value to disk (pretty-printed, 2-space indent).
 *
 * The write is atomic (temp file in the same folder, then rename), so a
 * process reading the file at the same moment sees the old or the new JSON,
 * never a truncated half, which would fail with "Unexpected end of JSON input".
 */
export async function putJsonFileAsync(filePath: string, value: unknown): Promise<void> {
  await atomicWriteAsync(filePath, JSON.stringify(value, null, 2));
}

/** Synchronous, atomic counterpart of {@link putJsonFileAsync}. */
export function putJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );

  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf-8");
    renameSyncWithRetry(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Rename over `to`, retrying a Windows sharing violation (EPERM / EACCES /
 * EBUSY, another handle has the target open) for about 4 seconds. Elsewhere
 * the first attempt succeeds, so the schedule never runs.
 */
function renameSyncWithRetry(from: string, to: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const attempts = process.platform === "win32" ? 30 : 1;

  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);

      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";

      if (!transient || attempt >= attempts) throw error;

      Atomics.wait(sleeper, 0, 0, Math.min(10 * 2 ** (attempt - 1), 150));
    }
  }
}
