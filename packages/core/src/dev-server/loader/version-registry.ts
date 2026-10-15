/**
 * Version registry for the ESM loader hook.
 *
 * Lives in the hook worker thread. The main thread sends bump messages via
 * MessageChannel; each bump increments the monotonic counter for that path,
 * which causes `resolve()` to produce a new URL — Node sees a fresh module.
 *
 * Monotonic integers are used instead of timestamps so there is no clock-drift
 * risk and the version is trivial to reason about during debugging.
 *
 * @example
 * // Hook worker receives a bump from the file watcher:
 * bumpVersion("/abs/path/to/user.model.ts");
 * // → getVersion returns 1, resolve() appends ?v=1 to the URL
 */

const versionMap = new Map<string, number>();

/**
 * Normalize a filesystem path to a single canonical form so the main thread
 * (which often holds forward-slash paths from posix-style joins) and the
 * hook worker (which gets backslash paths from `fileURLToPath` on Windows)
 * agree on map keys.
 */
function normalizeKey(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Increment the version counter for the given absolute path.
 * Called when the file watcher detects a change.
 */
export function bumpVersion(absolutePath: string): void {
  const key = normalizeKey(absolutePath);
  versionMap.set(key, (versionMap.get(key) ?? 0) + 1);
}

/**
 * Return the current version counter for the given absolute path.
 * Returns 0 for paths not yet seen (first import).
 */
export function getVersion(absolutePath: string): number {
  return versionMap.get(normalizeKey(absolutePath)) ?? 0;
}
