import path from "node:path";

/**
 * Whether `candidate` is strictly inside `directory` (never equal to it).
 *
 * Both paths must already be absolute and resolved. The check compares against
 * `directory + path.sep`, so a sibling sharing the directory's name as a prefix
 * (`/srv/storage-evil` next to `/srv/storage`) is outside. On win32 the
 * comparison is case-insensitive, matching the filesystem.
 */
export function isPathInside(candidate: string, directory: string): boolean {
  const prefix = directory.endsWith(path.sep) ? directory : directory + path.sep;

  if (process.platform === "win32") {
    return candidate.toLowerCase().startsWith(prefix.toLowerCase());
  }

  return candidate.startsWith(prefix);
}

/**
 * Whether `candidate` is `directory` itself or anything inside it
 */
export function isPathWithin(candidate: string, directory: string): boolean {
  const same =
    process.platform === "win32"
      ? candidate.toLowerCase() === directory.toLowerCase()
      : candidate === directory;

  return same || isPathInside(candidate, directory);
}
