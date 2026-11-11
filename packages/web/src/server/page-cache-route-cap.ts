/**
 * The page cache's per-route variant ceiling — `pageCache.maxEntriesPerRoute`
 * (default 1,000). Every distinct query string on a `serverCache` route is
 * its own entry, so without a ceiling a client looping over `?n=1..N` could
 * fill the cache backend with one full document per request for the whole
 * TTL. Once a route holds the ceiling's worth of live entries, further NEW
 * variants are served normally but not stored; variants already stored keep
 * being refreshed.
 *
 * Counted per process and per route declaration (its `cache` object), with
 * each slot released when the entry's TTL ends. An entry evicted early by
 * `invalidatePageCache` keeps its slot until its TTL ends, so the count can
 * only over-estimate what the backend holds, never under-estimate it.
 */
import { config } from "@warlock.js/core";
import type { PageCacheOptIn } from "../routing/route-identity";

/** Default ceiling on stored variants per route — 1,000. */
export const DEFAULT_PAGE_CACHE_MAX_ENTRIES_PER_ROUTE = 1_000;

/** Raised at config-read time when `pageCache.maxEntriesPerRoute` is not a positive integer or `false`. */
export class InvalidPageCacheMaxEntriesPerRouteError extends Error {
  public constructor(value: unknown) {
    super(
      `"pageCache.maxEntriesPerRoute" must be a positive integer, or false to remove the ceiling; ` +
        `received ${JSON.stringify(value)}.`,
    );
    this.name = "InvalidPageCacheMaxEntriesPerRouteError";
  }
}

/** Reads `pageCache.maxEntriesPerRoute` fresh on every call; `false` means no ceiling. */
export function resolvePageCacheMaxEntriesPerRoute(): number | false {
  const value = config.key(
    "pageCache.maxEntriesPerRoute",
    DEFAULT_PAGE_CACHE_MAX_ENTRIES_PER_ROUTE,
  ) as unknown;

  if (value === false) return false;

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new InvalidPageCacheMaxEntriesPerRouteError(value);
  }

  return value;
}

/** Live slots per route: cache key → expiry time in milliseconds. */
const slotsByRoute = new WeakMap<PageCacheOptIn, Map<string, number>>();
const warnedRoutes = new WeakSet<PageCacheOptIn>();

/**
 * Claims (or refreshes) the slot for `cacheKey` on this route. Returns
 * `false` when the route already holds the ceiling's worth of other live
 * variants, in which case the caller must not store this render.
 */
export function admitPageCacheEntry(
  cache: PageCacheOptIn,
  cacheKey: string,
  ttlSeconds: number,
  now: number = Date.now(),
): boolean {
  const limit = resolvePageCacheMaxEntriesPerRoute();

  if (limit === false) return true;

  let slots = slotsByRoute.get(cache);

  if (slots === undefined) {
    slots = new Map();
    slotsByRoute.set(cache, slots);
  }

  const expiresAt = now + ttlSeconds * 1000;

  if (slots.has(cacheKey)) {
    slots.set(cacheKey, expiresAt);
    return true;
  }

  if (slots.size >= limit) {
    for (const [key, slotExpiresAt] of slots) {
      if (slotExpiresAt <= now) slots.delete(key);
    }
  }

  if (slots.size >= limit) {
    if (!warnedRoutes.has(cache)) {
      warnedRoutes.add(cache);
      console.warn("[warlock:web] page-cache entry not stored:", {
        reason: "route_variant_limit",
        limit,
        hint:
          "This route already stores the maximum number of query-string variants. Declare " +
          "`cache.query` with the parameters that change the page, or raise " +
          '"pageCache.maxEntriesPerRoute".',
      });
    }

    return false;
  }

  slots.set(cacheKey, expiresAt);

  return true;
}
