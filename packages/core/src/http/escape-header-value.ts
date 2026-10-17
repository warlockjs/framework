/**
 * Characters Node refuses in a header value (`ERR_INVALID_CHAR`): control
 * characters other than horizontal tab, and anything outside ISO-8859-1.
 */
// oxlint-disable-next-line eslint/no-control-regex -- removing control characters is the point.
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

const OUTSIDE_LATIN1 = /[\u{100}-\u{10ffff}]/gu;

/**
 * Make any value safe to send as an HTTP header value: CR, LF, NUL and other
 * control characters (except tab) are removed, so input cannot split the
 * header or inject another one, characters outside ISO-8859-1 become `?`, and
 * surrounding whitespace is trimmed.
 *
 * Node already refuses a header value with CR/LF, but by throwing — which
 * turns a crafted value into a 500. Escape values built from request input or
 * stored user data before `response.header()`:
 *
 * @example
 * response.header("X-Export-Name", escapeHeaderValue(request.input("name")));
 */
export function escapeHeaderValue(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);

  return text.replace(FORBIDDEN_CONTROL, "").replace(OUTSIDE_LATIN1, "?").trim();
}
