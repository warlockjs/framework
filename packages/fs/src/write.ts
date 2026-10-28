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
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
