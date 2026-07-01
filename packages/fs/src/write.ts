import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
 */
export async function putJsonFileAsync(filePath: string, value: unknown): Promise<void> {
  await putFileAsync(filePath, JSON.stringify(value, null, 2));
}

export function putJsonFile(filePath: string, value: unknown): void {
  putFile(filePath, JSON.stringify(value, null, 2));
}
