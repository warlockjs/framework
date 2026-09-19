import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside, isPathWithin } from "./is-path-inside";

/**
 * A request path that resolved to a regular file inside the storage root
 */
export type ResolvedUploadPath = {
  /**
   * Real (symlink-free) absolute path of the file
   */
  absolutePath: string;

  /**
   * Path of the file relative to the real storage root, `/`-separated
   */
  relativePath: string;
};

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

/**
 * Resolve the wildcard of an uploads route to a file inside the storage root.
 *
 * The wildcard arrives already decoded once by the router and is NOT decoded
 * again: a second decode would turn `%252e%252e%252f` into `../`.
 *
 * Returns `undefined` — the caller answers 404 for every case, so the response
 * is no existence oracle — when the path:
 * - is empty, carries a NUL byte, or is absolute
 * - resolves outside the root, or to the root itself
 * - lies in one of the `excludedDirectories` (the variant cache)
 * - does not exist, or is not a regular file
 * - is (or passes through) a symlink whose target leaves the root
 */
export async function resolveUploadPath(
  wildcard: unknown,
  storageRoot: string,
  excludedDirectories: readonly string[] = [],
): Promise<ResolvedUploadPath | undefined> {
  if (typeof wildcard !== "string" || wildcard === "" || wildcard.includes("\0")) {
    return undefined;
  }

  if (path.isAbsolute(wildcard) || path.win32.isAbsolute(wildcard) || /^[A-Za-z]:/.test(wildcard)) {
    return undefined;
  }

  const root = path.resolve(storageRoot);
  const resolved = path.resolve(root, wildcard);

  if (!isPathInside(resolved, root)) return undefined;

  for (const excluded of excludedDirectories) {
    if (isPathWithin(resolved, path.resolve(excluded))) return undefined;
  }

  let realPath: string;

  try {
    realPath = await fs.realpath(resolved);
  } catch {
    return undefined;
  }

  const realRoot = await realpathOrSelf(root);

  if (!isPathInside(realPath, realRoot)) return undefined;

  for (const excluded of excludedDirectories) {
    if (isPathWithin(realPath, await realpathOrSelf(path.resolve(excluded)))) return undefined;
  }

  try {
    const stats = await fs.stat(realPath);

    if (!stats.isFile()) return undefined;
  } catch {
    return undefined;
  }

  return {
    absolutePath: realPath,
    relativePath: path.relative(realRoot, realPath).split(path.sep).join("/"),
  };
}
