/**
 * The Origin/Referer same-origin (or `auth.csrf.allowedOrigins`) policy — the
 * one comparison every CSRF-Origin check in the framework must agree on.
 *
 * SECURITY, card 8a752ab2 (5.17). Extracted from
 * `@warlock.js/auth`'s `csrf-origin-check.ts` (the ONLY prior owner of this
 * logic) into `@warlock.js/core` so both call sites — the
 * `authMiddleware("cookie:*")` check in `@warlock.js/auth` and the default
 * core HTTP-seam guard in `./csrf-default-guard.ts` — share ONE
 * implementation instead of drifting copies. `@warlock.js/core` cannot depend
 * on `@warlock.js/auth` (the dependency runs the other way), so the shared
 * logic had to move down into `core`, not up into a new shared package —
 * `auth`'s `csrf-origin-check.ts` now delegates to
 * {@link resolveCsrfOriginVerdict} instead of reimplementing it.
 *
 * Reads `auth.csrf.allowedOrigins` directly via `@mongez/config` (the exact
 * same config key `@warlock.js/auth`'s `authConfig.csrf.allowedOrigins()`
 * reads) rather than importing `@warlock.js/auth`, so an app's one
 * `auth.csrf.allowedOrigins` setting governs both checks without `core`
 * taking a hard dependency on `auth`.
 */
import config from "@mongez/config";
import type { Request } from "./request";

/** Why {@link resolveCsrfOriginVerdict} refused a request. */
export type CsrfOriginCheckReason =
  | "origin-mismatch"
  | "referer-mismatch"
  | "missing-origin-and-referer";

/** The verdict {@link resolveCsrfOriginVerdict} reaches for one request. */
export type CsrfOriginVerdict =
  | { allowed: true }
  | { allowed: false; reason: CsrfOriginCheckReason };

/**
 * The request's own origin — what an `Origin`/`Referer` header must match.
 *
 * `request.hostname` (core's `Request`, backed by Fastify's `hostname`) never
 * carries a port. A browser's `Origin` header on a non-default port (e.g. any
 * `warlock dev` session) does, so the port must come from the raw `Host`
 * header instead — core exposes no getter for that, so it is read directly
 * here.
 *
 * Trust-proxy-aware for free: `request.protocol` is Fastify's own
 * `request.protocol`, which already honours `http.trustProxy`
 * (`X-Forwarded-Proto`) when the app has configured it (`server.ts`) — this
 * function does not need its own proxy-trust logic on top of that.
 */
export function ownOrigin(request: Request): string {
  // Fastify's `host` keeps the port and honours `X-Forwarded-Host` under
  // `trustProxy`, so a proxy that rewrites `Host` does not break the match.
  const fastifyHost = request.baseRequest?.host;
  const hostHeader = request.header("host");
  const host =
    typeof fastifyHost === "string" && fastifyHost
      ? fastifyHost
      : typeof hostHeader === "string" && hostHeader
        ? hostHeader
        : request.hostname;

  return `${request.protocol}://${host}`;
}

/** Extract `scheme://host` from a full URL (e.g. a `Referer` header value). */
export function originOf(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);

    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/**
 * Normalize an origin string (`scheme://host[:port]`) so that a default port
 * (`:80` on `http:`, `:443` on `https:`) compares equal to the same origin
 * written without a port. Falls back to the raw value if it does not parse
 * as a URL (in which case it will simply fail the exact-match comparison).
 */
export function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const isDefaultPort =
      (url.protocol === "http:" && (url.port === "" || url.port === "80")) ||
      (url.protocol === "https:" && (url.port === "" || url.port === "443"));

    return `${url.protocol}//${isDefaultPort ? url.hostname : url.host}`;
  } catch {
    return origin;
  }
}

/** Same-origin, or an explicit entry in `auth.csrf.allowedOrigins` (default `[]`). */
export function isAllowedCsrfOrigin(origin: string, request: Request): boolean {
  if (normalizeOrigin(origin) === normalizeOrigin(ownOrigin(request))) return true;

  const allowedOrigins: string[] = config.get("auth.csrf.allowedOrigins", []);

  const normalized = normalizeOrigin(origin);

  return allowedOrigins.some(allowed => normalizeOrigin(allowed) === normalized);
}

/**
 * The shared CSRF Origin/Referer verdict (lead decision, card 8a752ab2 §3.1):
 * allowed when `Origin` — or, when `Origin` is absent, `Referer` — names the
 * request's own origin or an entry in `auth.csrf.allowedOrigins`. Refused
 * otherwise, including when BOTH headers are absent (fail closed).
 *
 * Callers decide WHETHER a request is in scope for this check at all (a
 * cookie-sourced credential / a non-locale cookie, an unsafe method, no route
 * exemption) — this function only answers the Origin/Referer question once a
 * caller has already decided the check applies.
 */
export function resolveCsrfOriginVerdict(request: Request): CsrfOriginVerdict {
  const origin = request.origin;

  if (origin) {
    return isAllowedCsrfOrigin(origin, request)
      ? { allowed: true }
      : { allowed: false, reason: "origin-mismatch" };
  }

  const referer = request.header("referer");
  const refererOrigin = typeof referer === "string" ? originOf(referer) : undefined;

  if (refererOrigin) {
    return isAllowedCsrfOrigin(refererOrigin, request)
      ? { allowed: true }
      : { allowed: false, reason: "referer-mismatch" };
  }

  return { allowed: false, reason: "missing-origin-and-referer" };
}
