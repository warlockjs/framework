import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getJsonFileAsync,
  putJsonFileAsync,
  unlinkAsync,
} from "@warlock.js/fs";
import { warlockPath } from "../utils/paths";

/** Where the last registry answer is remembered, inside the project's `.warlock/`. */
const CACHE_PATH = warlockPath("update-check.json");

/**
 * How long a registry answer stays good. A day matches npm's own
 * update-notifier: long enough that a normal day of `warlock dev` restarts
 * costs one lookup, short enough that a release never goes unnoticed for long.
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** What we remember between runs. Only successful lookups are ever stored. */
type UpdateCheckCache = {
  /** Epoch millis of the lookup. */
  checkedAt: number;
  /** The version the registry reported. */
  latest: string;
};

/**
 * The remembered latest version, or `undefined` when there is nothing usable —
 * no cache, a stale one, or a corrupt one. Callers treat `undefined` as
 * "ask npm".
 */
export async function readCachedLatestVersion(
  now: number = Date.now(),
): Promise<string | undefined> {
  try {
    if (!(await fileExistsAsync(CACHE_PATH))) {
      return undefined;
    }

    const cache = (await getJsonFileAsync(CACHE_PATH)) as Partial<UpdateCheckCache>;

    if (typeof cache?.checkedAt !== "number" || typeof cache?.latest !== "string") {
      return undefined;
    }

    // A clock that moved backwards (timezone change, VM resume, a hand-edited
    // file) would otherwise pin the cache as "fresh" indefinitely.
    const age = now - cache.checkedAt;

    if (age < 0 || age > CACHE_TTL_MS) {
      return undefined;
    }

    return cache.latest;
  } catch {
    // The cache is an optimisation — an unreadable one just means "ask npm".
    return undefined;
  }
}

/** Remember a successful registry answer. Failures are silent by design. */
export async function writeCachedLatestVersion(
  latest: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    await ensureDirectoryAsync(warlockPath());
    await putJsonFileAsync(CACHE_PATH, { checkedAt: now, latest } satisfies UpdateCheckCache);
  } catch {
    // Not being able to remember is not a reason to fail the check.
  }
}

/**
 * Forget the cached answer — called once an update has actually been applied,
 * so the next boot re-checks against the version we just installed instead of
 * reasoning from an answer that predates it.
 */
export async function clearCachedLatestVersion(): Promise<void> {
  try {
    if (await fileExistsAsync(CACHE_PATH)) {
      await unlinkAsync(CACHE_PATH);
    }
  } catch {
    // Worst case the next boot reads a stale-but-harmless entry.
  }
}
