import { InvalidBaseUrlError } from "./errors";

/**
 * Joins a configured origin and an app-relative route path into one absolute
 * URL, with exactly one slash at the seam regardless of whether either side
 * already carries one.
 */
export function joinOrigin(origin: string, routePath: string): string {
  const trimmedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;

  return `${trimmedOrigin}${normalizedPath}`;
}

/**
 * Validates a `baseUrl` and returns it without its trailing slash.
 *
 * `new URL()` accepts `mailto:` and `file:` happily, so the protocol is
 * checked explicitly — a sitemap `<loc>` that is not http(s) is not a document
 * any crawler will fetch.
 */
export function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidBaseUrlError(value, "expected a non-empty string");
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidBaseUrlError(value, "not an absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidBaseUrlError(value, `unsupported protocol "${parsed.protocol}"`);
  }

  const href = parsed.href;

  return href.endsWith("/") ? href.slice(0, -1) : href;
}

/** True for a value already usable as a `<loc>` without joining an origin. */
export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Resolves an entry or alternate path against the base URL, unless it is already absolute. */
export function resolveAgainstBase(baseUrl: string, path: string): string {
  return isAbsoluteUrl(path) ? path : joinOrigin(baseUrl, path);
}
