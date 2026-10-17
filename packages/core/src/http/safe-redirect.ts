/**
 * Redirect targets that come from the request (`?next=`, `returnTo`, a
 * `Referer`) are attacker-controlled. Following them as-is is an open
 * redirect: a link to your login page can forward the signed-in user to a
 * look-alike site, and a `javascript:` target runs script on your origin.
 *
 * `safeRedirect()` lets through only same-origin paths and absolute
 * `http:`/`https:` URLs whose origin is explicitly allowed, and answers the
 * fallback for anything else.
 */

// oxlint-disable-next-line eslint/no-control-regex -- refusing control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Base used to parse relative targets; never part of a result. */
const PARSE_BASE = "http://warlock.invalid";

export type SafeRedirectOptions = {
  /**
   * Origins an absolute target may point at, e.g. `["https://app.example.com"]`.
   * Compared as parsed origins (scheme, host and port), so a path or a
   * trailing slash in an entry is ignored. Empty by default: only same-origin
   * paths are followed.
   */
  allowedOrigins?: readonly string[];
  /**
   * Returned when the target is refused. Defaults to `"/"`.
   */
  fallback?: string;
};

/**
 * Whether `target` is safe to redirect to: a path on this origin
 * (`/dashboard?tab=2`), or an absolute `http:`/`https:` URL whose origin is in
 * `allowedOrigins`. Refused: protocol-relative (`//evil.com`) and backslash
 * (`/\evil.com`) paths, other schemes (`javascript:`, `data:`), relative
 * paths that do not start with `/`, credentials in the URL, and any control
 * character (browsers drop tabs and newlines inside a scheme, and CR/LF would
 * split the `Location` header).
 *
 * @example
 * if (isSafeRedirect(request.input("next"))) { … }
 */
export function isSafeRedirect(target: unknown, options: SafeRedirectOptions = {}): boolean {
  if (typeof target !== "string") return false;

  const value = target.trim();
  if (value === "" || value !== target) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;

  if (value.startsWith("/")) {
    // `//host` and `/\host` are read by browsers as another origin.
    if (value.startsWith("//") || value.startsWith("/\\")) return false;
    if (value.includes("\\")) return false;

    return parsesToSameOrigin(value);
  }

  const allowed = normalizeOrigins(options.allowedOrigins);
  if (allowed.size === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;

  return allowed.has(parsed.origin);
}

/**
 * Return `target` when {@link isSafeRedirect} accepts it, otherwise the
 * fallback (`"/"` unless configured). The result is always a string, so it
 * can go straight into `response.redirect()`.
 *
 * @example
 * return response.redirect(
 *   safeRedirect(request.input("next"), { allowedOrigins: ["https://app.example.com"] }),
 * );
 */
export function safeRedirect(target: unknown, options: SafeRedirectOptions = {}): string {
  return isSafeRedirect(target, options) ? (target as string) : (options.fallback ?? "/");
}

function parsesToSameOrigin(path: string): boolean {
  try {
    return new URL(path, PARSE_BASE).origin === PARSE_BASE;
  } catch {
    return false;
  }
}

function normalizeOrigins(origins: readonly string[] | undefined): Set<string> {
  const result = new Set<string>();

  for (const origin of origins ?? []) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") result.add(parsed.origin);
    } catch {
      // An entry that is not a URL allows nothing.
    }
  }

  return result;
}
