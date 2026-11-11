import type { Auth } from "@warlock.js/auth";

/**
 * How long a resolved set is reused for the same user object. Long enough to
 * cover one request's stacked gates and `can()` calls, short enough that a
 * long-lived user object (a worker, a test fixture) never holds a set much
 * longer than the shared cache would.
 */
const MEMO_MAX_AGE_MS = 1000;

type MemoEntry = { value: Promise<string[]>; at: number; generation: number };

/** Resolved sets per user object; an entry dies with the object it belongs to. */
const memos = new WeakMap<object, Map<string, MemoEntry>>();

/**
 * Bumped by {@link invalidateResolutionMemo}: every entry from an older
 * generation is ignored, so `flush()` and a new configuration take effect at
 * once for every user object in this process.
 */
let generation = 0;

/** Drop every memoised set in this process. */
export function invalidateResolutionMemo(): void {
  generation++;
}

/**
 * Resolve `key` for `user` once and share the promise with every check on the
 * same user object for {@link MEMO_MAX_AGE_MS}. A rejected load is never
 * reused, so a failed resolution is retried on the next check.
 */
export function memoizeForUser(
  user: Auth,
  key: string,
  load: () => Promise<string[]>,
): Promise<string[]> {
  if (typeof user !== "object" || user === null) return load();

  let entries = memos.get(user);

  if (!entries) {
    entries = new Map();
    memos.set(user, entries);
  }

  const now = Date.now();
  const hit = entries.get(key);

  if (hit && hit.generation === generation && now - hit.at < MEMO_MAX_AGE_MS) {
    return hit.value;
  }

  const value = load();
  const owner = entries;

  owner.set(key, { value, at: now, generation });

  value.catch(() => {
    if (owner.get(key)?.value === value) owner.delete(key);
  });

  return value;
}
