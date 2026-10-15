import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

export type HashAlgorithm = "sha256" | "sha1" | "md5" | "sha512";

/**
 * Compute a hex digest of a file's contents. Uses streaming for large
 * files so memory doesn't spike when hashing big assets.
 *
 * @param path - File to hash.
 * @param algorithm - Hash algorithm (default `sha256`).
 *
 * @example
 *   const fingerprint = await hashFile("./bundle.js");
 *   const quick = await hashFile("./small.txt", "md5");
 */
export function hashFileAsync(
  path: string,
  algorithm: HashAlgorithm = "sha256",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function hashFile(path: string, algorithm: HashAlgorithm = "sha256"): string {
  return createHash(algorithm).update(readFileSync(path)).digest("hex");
}

/**
 * Hash an in-memory string without touching disk. Convenient when the
 * caller already has the content loaded (e.g. file watcher diffing).
 */
export function hashString(content: string, algorithm: HashAlgorithm = "sha256"): string {
  return createHash(algorithm).update(content).digest("hex");
}

/**
 * Hash an arbitrary buffer.
 */
export function hashBuffer(
  content: Buffer | Uint8Array,
  algorithm: HashAlgorithm = "sha256",
): string {
  return createHash(algorithm).update(content).digest("hex");
}

/**
 * Like `hashFileAsync` but reads the file in one go. Slightly faster for
 * small files; use the streaming variant for anything > ~1 MB.
 */
export async function hashFileSmallAsync(
  path: string,
  algorithm: HashAlgorithm = "sha256",
): Promise<string> {
  return createHash(algorithm).update(await readFile(path)).digest("hex");
}
