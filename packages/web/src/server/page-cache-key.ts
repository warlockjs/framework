/**
 * Pure cache-key composition for the server-side page cache
 * (`page-cache-store.ts`). Mirrors the axes the page pipeline varies a
 * response on — host, path, query, locale, representation, and a route's
 * optional `cache.varyBy` — so a
 * request that would get different bytes never shares an entry with one that
 * wouldn't, and a request that would get the SAME bytes always does.
 *
 * Deliberately dependency-free: no `fs`, no Node built-ins, no framework
 * imports — just string logic, so it is trivial to unit test and safe to call
 * from any runtime this package ends up in.
 */

/** The two representations the page cache stores. NDJSON is never a variant — see `page-cache-key.spec.ts`. */
export type PageCacheVariant = "html" | "json";

export type PageCacheKeyInput = {
  /**
   * The request host, port included: the `Host` header, or the selected
   * site's host in multi-site mode. Two hosts serving the same URL are two
   * tenants until proven otherwise, and a key without the host lets a render
   * that reflects the host poison every other host's visitors.
   */
  host: string;
  /** The raw request path, query string included — `request.path`. */
  path: string;
  /** The raw request query object — `request.query`. */
  query: Record<string, unknown>;
  locale: string;
  variant: PageCacheVariant;
  /** The route's own `cache.varyBy(request)` result, when it declares one. */
  vary?: string;
  /**
   * The route's `cache.query` allowlist. When set, ONLY these query keys enter
   * the key; when absent, every key except {@link IGNORED_TRACKING_PARAMS}.
   */
  queryAllowlist?: readonly string[];
  /** Content identity of route-owned translations, absent for legacy registration. */
  translationsRevision?: string;
  /** Selected multi-site identity, absent in single-site applications. */
  site?: string;
  /** Resolver identity within a selected site, when applicable. */
  tenantKey?: string;
};

/** Tracking params that never change the rendered bytes; ignored when no allowlist is set. */
const IGNORED_TRACKING_PARAMS = /^(utm_[a-z0-9_]*|fbclid|gclid|msclkid|mc_eid|_ga)$/i;

/**
 * Normalises a pathname the same way `create-page-route-handler.ts` already
 * splits `request.path` on `"?"` — case preserved, trailing slash stripped
 * except for the root `"/"`.
 */
function normalisePathname(path: string): string {
  const [pathname = path] = path.split("?");

  // Case is KEPT: production routing is case-sensitive and params keep their
  // case, so `/users/Alice` and `/users/alice` are two different pages.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

/** Whether a query key enters the cache key under the route's allowlist (or the tracking-param default). */
function isKeyedQueryParam(key: string, allowlist: readonly string[] | undefined): boolean {
  return allowlist === undefined ? !IGNORED_TRACKING_PARAMS.test(key) : allowlist.includes(key);
}

/**
 * True when the request carries a query parameter that the cache key leaves
 * out (a tracking parameter, or a key outside `cache.query`). Such a request
 * may be served a stored entry, but its own render must never be stored: the
 * page and its loaders see every parameter, so the bytes could reflect a
 * value that the key does not describe.
 */
export function hasUnkeyedQueryParams(
  query: Record<string, unknown>,
  allowlist: readonly string[] | undefined,
): boolean {
  return Object.keys(query).some(
    (key) => query[key] !== undefined && !isKeyedQueryParam(key, allowlist),
  );
}

/**
 * Appends one query value. Scalars are written as they are; arrays repeat the
 * key in their given order; an object (`?filter[status]=draft`, which the
 * request parser turns into `{ filter: { status: "draft" } }`) is flattened to
 * bracketed keys with its own keys sorted, so two different nested values
 * never share an entry.
 */
function appendQueryValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      if (item !== null && typeof item === "object") {
        appendQueryValue(params, `${key}[${index}]`, item);
      } else {
        appendQueryValue(params, key, item);
      }
    });

    return;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const nestedKey of Object.keys(record).sort()) {
      appendQueryValue(params, `${key}[${nestedKey}]`, record[nestedKey]);
    }

    return;
  }

  params.append(key, String(value));
}

/**
 * Sorts query keys and re-serializes them, so two requests differing only in
 * parameter order (`?a=1&b=2` vs `?b=2&a=1`) resolve to the same string.
 * Array values are serialized in their given order — only the KEYS are
 * sorted, not each value's contents.
 */
function normaliseQuery(
  query: Record<string, unknown>,
  allowlist: readonly string[] | undefined,
): string {
  const keys = Object.keys(query)
    .filter((key) => isKeyedQueryParam(key, allowlist))
    .sort();
  const params = new URLSearchParams();

  for (const key of keys) {
    appendQueryValue(params, key, query[key]);
  }

  return params.toString();
}

/**
 * Composes the server-side page cache key:
 * `host + (normalised path) + "?" + (sorted query) + "|" + locale + "|" + variant`,
 * plus `"|vary=" + varyBy` when the route declares one.
 *
 * The `variant` is decided by the CALLER from `wantsData` alone — a request
 * that asks for NDJSON on a cache-eligible route still resolves to the
 * `"json"` variant, since the values behind it are always fully resolved
 * before storage (see `create-page-route-handler.ts`).
 */
export function computePageCacheKey(input: PageCacheKeyInput): string {
  const pathname = normalisePathname(input.path);
  const query = normaliseQuery(input.query, input.queryAllowlist);

  const host = input.host.toLowerCase();
  const vary = input.vary === undefined ? "" : `|vary=${encodeURIComponent(input.vary)}`;
  const translations =
    input.translationsRevision === undefined
      ? ""
      : `|translations=${encodeURIComponent(input.translationsRevision)}`;
  const site = input.site === undefined ? "" : `|site=${encodeURIComponent(input.site)}`;
  const tenantKey =
    input.tenantKey === undefined ? "" : `|tenantKey=${encodeURIComponent(input.tenantKey)}`;

  // The host is URI-component encoded so no host value can forge the path
  // part of another entry's key.
  return `${encodeURIComponent(host)}${pathname}?${query}|${input.locale}|${input.variant}${vary}${translations}${site}${tenantKey}`;
}
