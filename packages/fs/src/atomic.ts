import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { renameWithRetry } from "./retry-rename";

export { AtomicWriteError } from "./atomic-write-error";

/**
 * Write a file atomically.
 *
 * Writes to a uniquely-named sibling temp file first, then renames it onto
 * the target. Readers either see the old content or the complete new
 * content — never a half-written file. If anything fails mid-write the
 * temp file is cleaned up.
 *
 * The rename step retries with bounded backoff on transient Windows locks
 * (`EPERM` / `EBUSY` / `EACCES` — antivirus or the search indexer briefly
 * holding the target); see {@link renameWithRetry}. It still never falls
 * back to a non-atomic direct write — if every retry fails, it throws
 * {@link AtomicWriteError} naming the target, the attempt count, and the
 * last OS error as `cause`.
 *
 * Parent directories are created if missing.
 *
 * @example
 *   await atomicWriteAsync("manifest.json", JSON.stringify(data));
 */
export async function atomicWriteAsync(filePath: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  // Random suffix so concurrent writers don't fight over the same temp file.
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );

  try {
    await writeFile(tempPath, content);
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Atomic write convenience for JSON values (pretty-printed, 2-space indent).
 */
export async function atomicWriteJsonAsync(filePath: string, value: unknown): Promise<void> {
  await atomicWriteAsync(filePath, JSON.stringify(value, null, 2));
}
