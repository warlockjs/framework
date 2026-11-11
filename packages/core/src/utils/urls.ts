const LEADING_SLASHES = /^\/+/;
const TRAILING_SLASHES = /\/+$/;

/**
 * The base url without its trailing slashes, trimmed once in `setBaseUrl`
 * rather than on every `url()` call (resources build one per url field).
 */
let trimmedBaseUrl = "";

/** Remove every leading `/`. */
function stripLeadingSlashes(value: string): string {
  return value ? value.replace(LEADING_SLASHES, "") : "";
}

/**
 * Set base url
 */
export function setBaseUrl(url: string) {
  trimmedBaseUrl = url ? url.replace(TRAILING_SLASHES, "") : "";
}

/**
 * Get full path for the given path
 */
export function url(path = "") {
  return trimmedBaseUrl + "/" + stripLeadingSlashes(path);
}

/**
 * Get uploads url
 */
export function uploadsUrl(path = "") {
  return url("/uploads/" + stripLeadingSlashes(path));
}

/**
 * Get full path for the given path related to public route
 */
export function publicUrl(path = "") {
  return url("/public/" + stripLeadingSlashes(path));
}

/**
 * Assets url
 */
export function assetsUrl(path = "") {
  return publicUrl("/assets/" + stripLeadingSlashes(path));
}
