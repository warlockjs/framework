import { DEVTOOLS_SESSION_COOKIE, DEVTOOLS_SESSION_COOKIE_INSECURE } from "./constants";

/** The cookie name for the HTTPS mode. */
export function sessionCookieName(secure: boolean): string {
  return secure ? DEVTOOLS_SESSION_COOKIE : DEVTOOLS_SESSION_COOKIE_INSECURE;
}

/**
 * `Set-Cookie` value for a session token (or a clearing cookie when `token`
 * is `null`). The cookie is a browser-session cookie scoped to the dashboard
 * path, `HttpOnly` and `SameSite=Strict`, with no `Domain`.
 */
export function sessionCookie(
  token: string | null,
  options: { path: string; secure: boolean },
): string {
  const parts = [
    `${sessionCookieName(options.secure)}=${token ?? ""}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (options.secure) parts.push("Secure");

  if (token === null) parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");

  return parts.join("; ");
}

/** The value of cookie `name` in a `Cookie` header, or `undefined`. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const pair of header.split(";")) {
    const equals = pair.indexOf("=");

    if (equals === -1) continue;

    if (pair.slice(0, equals).trim() === name) {
      const value = pair.slice(equals + 1).trim();

      return value === "" ? undefined : value;
    }
  }

  return undefined;
}
