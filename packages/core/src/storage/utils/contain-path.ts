import path from "path";
import { StorageError } from "./storage-error";

/**
 * Resolve `location` against `root` and assert the result stays *inside*
 * `root` — the local-storage path-traversal guard.
 *
 * Without this, a `location` like `../../etc/passwd`, `..\..\windows\...`,
 * an absolute path (`/etc/passwd`, `C:\secret`), or a prefix breakout could
 * escape the configured storage root and read or clobber arbitrary files on
 * the host.
 *
 * The check compares the relative path from `root` to the resolved target:
 * if it climbs out (`..` prefix) or is itself absolute (different drive /
 * root on Windows), the location is rejected.
 *
 * @param root - Absolute, normalized storage root.
 * @param location - Caller-supplied (already prefix-applied) location.
 * @returns The absolute, contained filesystem path.
 * @throws {StorageError} When the location escapes `root`.
 */
export function resolveWithinRoot(root: string, location: string): string {
  const resolved = path.resolve(root, location);
  const rel = path.relative(root, resolved);

  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new StorageError(
      `Storage location escapes the storage root: "${location}"`,
      { context: { location, root } },
    );
  }

  return resolved;
}
