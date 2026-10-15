/**
 * The DEFAULT core CSRF-Origin guard — SECURITY, card 8a752ab2 (5.17), lead
 * ruling from Aria (`releases/v5.17-web-readiness-audit.md` §3.1, quoted):
 *
 * > "Scope the default guard to unsafe browser requests carrying a
 * > non-locale credential-looking cookie (fail closed on unknown names), at
 * > an early core/auth HTTP seam before app handlers; give explicit,
 * > narrowly scoped route-level exemptions for third-party callbacks and
 * > machine-to-machine routes, documented as dangerous. Reuse current
 * > same-origin/allowedOrigins policy, trustProxy-aware own origin, and fail
 * > closed on missing Origin/Referer where in scope."
 *
 * Before this guard, the CSRF Origin check (`csrf-origin-policy.ts`, moved
 * here from `@warlock.js/auth` in this same change) only ran inside
 * `authMiddleware("cookie:*")` — a cookie-authenticated write reaching any
 * OTHER path (an app-owned optional-auth pattern reading its own `token`
 * cookie without ever calling `authMiddleware`) was never checked at all.
 *
 * This guard closes that gap at the earliest seam common to EVERY request —
 * production (`Router.scan()`) and the dev wildcard dispatcher both funnel
 * into `Router["handleRoute"]` → `request.execute()` →
 * `createRequestStore()` (`./middleware/inject-request-context.ts`), which is
 * where this is wired, BEFORE `request.runMiddleware()` runs the route's own
 * middleware (so it applies with or without `authMiddleware` on the route)
 * and before any app handler. It lives in `@warlock.js/core`, not
 * `@warlock.js/auth`, because `core` — not `auth` — is a dependency of every
 * Warlock app, so this is the only seam that reaches an app that never
 * installs `@warlock.js/auth` at all.
 *
 * Scope (mirrors `web`'s page-cache Cookie-header bypass rule,
 * `web/src/server/page-cache-cookie-bypass.ts`, card ad861076 — same
 * fail-closed strict-parse posture, independently reimplemented here because
 * `core` cannot depend on `web`, the dependency runs the other way):
 * - method is POST/PUT/PATCH/DELETE, AND
 * - the `Cookie` header carries any cookie other than the framework's own
 *   `locale` cookies (legacy plus the browser preference; a header that fails to parse cleanly counts as
 *   carrying one — fail closed), AND
 * - the route is not exempted via `{ csrf: false }` (`RouteOptions.csrf`,
 *   `../router/types.ts`) — a narrow, per-route, explicitly "dangerous" opt
 *   out for third-party callbacks and machine-to-machine routes.
 *
 * A header-only API request (`Authorization: Bearer …`, no `Cookie` header
 * at all) never reaches the cookie check above and is entirely unaffected.
 */
import { LOCALE_COOKIE_NAME, LOCALE_PREFERENCE_COOKIE_NAME } from "../config/locale-configuration";
import { HttpErrorCodes } from "./error-codes";
import { resolveCsrfOriginVerdict } from "./csrf-origin-policy";
import type { Request } from "./request";
import type { Response } from "./response";

/** HTTP methods the default CSRF guard is scoped to — every unsafe method. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Strictly parse a raw `Cookie` request header into a set of cookie names, or
 * `undefined` when the header does not parse cleanly.
 *
 * Deliberately NOT a lenient cookie parser that silently drops malformed
 * pairs and returns whatever it could salvage: a header this function cannot
 * fully account for must read as "unknown cookies present", never as "the
 * pairs we understood, minus the ones we didn't" — dropping a pair is how a
 * malformed header could otherwise be misread as carrying only the locale
 * cookie (or none) and wrongly skip the guard. Mirrors
 * `web/src/server/page-cache-cookie-bypass.ts`'s `parseCookieHeaderStrict`.
 *
 * Fails (`undefined`) on:
 * - an empty or whitespace-only header;
 * - any empty segment between/around `;`;
 * - any segment with no `=`, or an empty name.
 */
function parseCookieNamesStrict(rawHeader: string): Set<string> | undefined {
  if (rawHeader.trim() === "") return undefined;

  const names = new Set<string>();

  for (const segment of rawHeader.split(";")) {
    const pair = segment.trim();

    if (pair === "") return undefined;

    const separatorIndex = pair.indexOf("=");

    if (separatorIndex <= 0) return undefined;

    const name = pair.slice(0, separatorIndex).trim();

    if (name === "") return undefined;

    names.add(name);
  }

  return names;
}

/**
 * Whether the request carries a `Cookie` header naming anything other than
 * the framework's locale cookies.
 *
 * - No `Cookie` header at all ⇒ `false` — nothing to guard on.
 * - A header that fails to parse cleanly ⇒ `true` — fails CLOSED.
 * - A header whose parsed names are a non-empty set equal to exactly
 *   `{locale}` ⇒ `false` — the one exemption.
 * - Anything else (any other cookie name, alone or alongside `locale`) ⇒ `true`.
 */
function carriesNonLocaleCookie(request: Request): boolean {
  const rawCookieHeader = request.header("cookie", undefined);

  // Only an ABSENT header is cookie-free. A present header in any other
  // shape (an array from a duplicated Cookie header) fails closed.
  if (rawCookieHeader === undefined || rawCookieHeader === null) return false;

  if (typeof rawCookieHeader !== "string") return true;

  const names = parseCookieNamesStrict(rawCookieHeader);

  if (names === undefined || names.size === 0) return true;

  for (const name of names) {
    if (name !== LOCALE_COOKIE_NAME && name !== LOCALE_PREFERENCE_COOKIE_NAME) return true;
  }

  return false;
}

/**
 * Whether the matched route opted out of the default CSRF guard via
 * `{ csrf: false }` (`RouteOptions.csrf`). Any other value — including
 * `undefined` — leaves the route in scope.
 */
function isCsrfExempt(request: Request): boolean {
  return request.route?.csrf === false;
}

/**
 * Whether the current request is in scope for the default core CSRF-Origin
 * guard at all.
 */
export function requiresDefaultCsrfGuard(request: Request): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return false;

  if (isCsrfExempt(request)) return false;

  return carriesNonLocaleCookie(request);
}

/**
 * Run the default core CSRF-Origin guard for the current request.
 *
 * Returns `undefined` when the request is out of scope or passes the
 * Origin/Referer check — the caller continues into route middleware and the
 * handler as normal. Returns the 403 {@link Response} when the guard refuses
 * the request; the caller must return that value immediately, the same
 * short-circuit contract every other middleware in the chain follows.
 *
 * Uses the SAME translated message and client-visible error code
 * `authMiddleware("cookie:*")`'s own CSRF-Origin check uses
 * (`auth.errors.csrfOriginMismatch`, `HttpErrorCodes.CsrfOriginMismatch` /
 * `AuthErrorCodes.CsrfOriginMismatch`, both `"EC006"`) — one message, one
 * error code, regardless of which seam caught the request. Logs exactly once
 * per rejection here; a route that also carries `authMiddleware("cookie:*")`
 * never reaches that middleware's own check for a request THIS guard already
 * rejected, because a guard rejection short-circuits `runMiddleware()`
 * entirely — so a rejected request is never logged twice.
 */
export async function runDefaultCsrfGuard(
  request: Request,
  response: Response,
  translate: (key: string) => string,
  logRejection: (reason: string) => void,
): Promise<Response | undefined> {
  if (!requiresDefaultCsrfGuard(request)) return undefined;

  const verdict = resolveCsrfOriginVerdict(request);

  if (verdict.allowed) return undefined;

  logRejection(verdict.reason);

  return response.forbidden({
    error: translate("auth.errors.csrfOriginMismatch"),
    errorCode: HttpErrorCodes.CsrfOriginMismatch,
  });
}
