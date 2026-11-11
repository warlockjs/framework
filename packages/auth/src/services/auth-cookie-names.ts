import { config } from "@warlock.js/core";
import { authConfig } from "./auth-config";

/** Name prefix browsers only accept on a Secure, `Path=/`, Domain-less cookie set by this host. */
export const HOST_COOKIE_PREFIX = "__Host-";

/** Whether `auth.cookie.hostPrefix` is on. */
function hostPrefixEnabled(): boolean {
  return authConfig.cookie.hostPrefix();
}

/**
 * The name an auth cookie is written under: `__Host-<name>` when
 * `auth.cookie.hostPrefix` is on, else `name` unchanged.
 */
export function authCookieWriteName(name: string): string {
  if (!hostPrefixEnabled() || name.startsWith(HOST_COOKIE_PREFIX)) return name;

  return `${HOST_COOKIE_PREFIX}${name}`;
}

/**
 * Every name an auth cookie may currently be stored under, newest first. With
 * `auth.cookie.hostPrefix` on, a browser may still hold the unprefixed cookie
 * written before the switch, so both are read (and both cleared).
 */
export function authCookieNames(name: string): string[] {
  const written = authCookieWriteName(name);

  return written === name ? [name] : [written, name];
}

/** Read an auth cookie under its prefixed name first, then the unprefixed one. */
export function readAuthCookie(
  request: { cookie: (name: string) => unknown },
  name: string,
): string {
  for (const candidate of authCookieNames(name)) {
    const value = request.cookie(candidate);

    if (value) return String(value);
  }

  return "";
}

/**
 * Refuse a cookie write that a browser would silently drop: a `__Host-`
 * cookie must be set with `Path=/` and no `Domain`.
 */
export function assertHostPrefixAllowed(
  name: string,
  attributes: { path?: string; domain?: string },
): void {
  if (!name.startsWith(HOST_COOKIE_PREFIX)) return;

  if (attributes.path !== undefined && attributes.path !== "/") {
    throw new Error(
      `auth.cookie.hostPrefix: cookie "${name}" must use Path=/ but was given "${attributes.path}". ` +
        `Set auth.cookie.path to "/" (and do not pass another path), or turn auth.cookie.hostPrefix off.`,
    );
  }

  const globalDomain = config.key<{ domain?: unknown } | undefined>("http.cookies.options")?.domain;

  if (attributes.domain !== undefined || (globalDomain !== undefined && globalDomain !== null)) {
    throw new Error(
      `auth.cookie.hostPrefix: cookie "${name}" cannot carry a Domain attribute. ` +
        "Remove auth.cookie.cookieDomain (and any domain in http.cookies.options), or turn auth.cookie.hostPrefix off.",
    );
  }
}
