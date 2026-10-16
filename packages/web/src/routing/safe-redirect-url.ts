/**
 * Whether a redirect target is one Warlock will follow or emit: a relative URL
 * (`/dashboard`, `?tab=2`, `#top`) or an absolute `http:`/`https:` one.
 *
 * Anything else is refused. A `javascript:` URL handed to
 * `window.location.assign()` runs as script on the page's origin, and `data:`,
 * `vbscript:` or `file:` have no business being a page's next location. Control
 * characters are refused too: browsers drop tabs and newlines inside a scheme
 * (`java\tscript:`), and CR/LF would split a `Location` header.
 */
export function isSafeRedirectUrl(url: string): boolean {
  if (url.trim() === "") return false;

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;

  let parsed: URL;

  try {
    parsed = new URL(url, "http://warlock.invalid/");
  } catch {
    return false;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** Throws when {@link isSafeRedirectUrl} refuses `url`. */
export function assertSafeRedirectUrl(url: string): void {
  if (isSafeRedirectUrl(url)) return;

  throw new Error(
    `Warlock refused to redirect to ${JSON.stringify(url)}: only relative, http: and https: URLs are allowed.`,
  );
}
