/**
 * The single `Vary` value one page-route response carries — HTML and JSON,
 * `serverCache` HIT and MISS, the render-failure fallback included — never
 * two separate `header("Vary", ...)` calls for the same response.
 *
 * `Response.header()` forwards to Fastify's `reply.header()`, which
 * REPLACES the stored value for a given key on every call except
 * `Set-Cookie` (`fastify/lib/reply.js`, `Reply.prototype.header`) — it does
 * not append. Two separate `header("Vary", ...)` calls on the same response
 * therefore silently drop the first value; computing the combined value once
 * here is what keeps a deferred HIT's `Vary: User-Agent` from being
 * overwritten by a later `Vary: x-warlock-data` call.
 *
 * Two independent reasons a response varies:
 *
 * - `dataRepresentation` — this response IS the JSON representation (the
 *   request carried `WARLOCK_DATA_REQUEST_HEADER`). A page route is one URL
 *   with two representations, so its JSON side has ALWAYS told a shared
 *   cache to keep it apart from the HTML side, regardless of whether the
 *   route opted into `route.cache` — this predates and is unrelated to the
 *   bug this helper fixes.
 * - `cacheOptedIn` — this route declared `route.cache`, so ITS HTML side can
 *   also be held by a shared cache (`Cache-Control: public, max-age=N`,
 *   `response-cache-floor.ts`). THIS is the bug: the HTML representation of
 *   such a route used to carry no `Vary` at all, so a CDN could cache the
 *   document and later serve it to an SPA data fetch. A route that never
 *   opted in is never held by a shared cache either way (`no-store`), so its
 *   HTML side deliberately stays silent on `x-warlock-data` — see
 *   `__tests__/server/crawler-mode.spec.ts`'s "a plain page (no defer())
 *   never carries Vary, for any user agent", which asserts exactly that.
 *
 * `deferred` appends `User-Agent`: rule 4 in `create-page-route-handler.ts`
 * — a page that never calls `defer()` renders identically for every user
 * agent; a page that DOES defer renders differently for a detected crawler
 * (fully resolved) than for anything else (streamed shell), the one axis a
 * response varies on by `User-Agent`. This applies to both representations
 * and is independent of `cacheOptedIn`.
 *
 * A cache-opted route's response is held by shared caches, so it also lists
 * every request input that changes it outside the URL:
 *
 * - `Cookie` and `locale` — the locale cookies and the `locale` request header
 *   select the page's locale unless the URL itself pinned it (a locale-prefixed
 *   or `[locale]` route, see {@link markLocaleFromPath}). Left out when the
 *   app supports a single locale, since nothing can change it then.
 * - `cache.varyHeaders` — headers the route declares it reads (for example
 *   the header its `cache.varyBy` reads).
 *
 * Returns `undefined` when neither condition applies — the pre-existing,
 * deliberate "no Vary header at all" case for a plain, non-cache-opted page
 * response, which the caller must then skip setting entirely.
 */
import { config, type Request } from "@warlock.js/core";
import { WARLOCK_DATA_REQUEST_HEADER } from "../routing/data-request";

/** Requests whose locale the URL pinned (prefix or `[locale]` segment). */
const pathLocaleRequests = new WeakSet<object>();

/**
 * Records that the URL selected this request's locale, so the cookie and the
 * `locale` header cannot change the response. Called by the locale-routing
 * handler wrappers right where they pin `request.locale`.
 */
export function markLocaleFromPath(request: Request): void {
  pathLocaleRequests.add(request);
}

/** True when the locale cookies or the `locale` header can change this request's locale. */
function localeVariesByRequest(request: Request): boolean {
  if (pathLocaleRequests.has(request)) return false;

  const codes = config.get("app.localeCodes") as unknown;
  const supported = Array.isArray(codes)
    ? codes.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];

  // Without a declared list core accepts any requested code, so it can vary.
  return supported.length !== 1;
}

export function pageVaryHeader(options: {
  /** True when this response is the JSON (data-request) representation. */
  dataRepresentation: boolean;
  /** True when the route declared `cache` (`PageCacheOptIn`, `route-identity.ts`). */
  cacheOptedIn: boolean;
  /** True when the rendered page called `defer()`. */
  deferred: boolean;
  /** The request, read for its locale source on a cache-opted route. */
  request?: Request;
  /** The route's `cache.varyHeaders`. */
  varyHeaders?: readonly string[];
}): string | undefined {
  const tokens: string[] = [];

  if (options.dataRepresentation || options.cacheOptedIn) {
    tokens.push(WARLOCK_DATA_REQUEST_HEADER);
  }

  if (options.deferred) {
    tokens.push("User-Agent");
  }

  if (options.cacheOptedIn) {
    if (options.request !== undefined && localeVariesByRequest(options.request)) {
      tokens.push("Cookie", "locale");
    }

    for (const header of options.varyHeaders ?? []) {
      if (!tokens.some((token) => token.toLowerCase() === header.toLowerCase())) {
        tokens.push(header);
      }
    }
  }

  return tokens.length > 0 ? tokens.join(", ") : undefined;
}
