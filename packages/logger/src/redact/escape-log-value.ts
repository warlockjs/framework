/**
 * ANSI escape sequences: CSI (`ESC [ … final`) and the two-character
 * `ESC x` escapes (`ESC c` resets a terminal). Bounded so matching stays linear on long input.
 */
// oxlint-disable-next-line eslint/no-control-regex -- matching terminal escapes is the point.
const ANSI_ESCAPE = /\u001b(?:\[[0-?]{0,32}[ -/]{0,8}[@-~]|[0-~])/g;

/** Control characters that are not already handled as `\r`, `\n` or `\t`. */
// oxlint-disable-next-line eslint/no-control-regex -- escaping control characters is the point.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;

export type EscapeLogValueOptions = {
  /**
   * Longest result, in characters. Longer values are cut and end with
   * `…[truncated]`. Unlimited by default.
   */
  maxLength?: number;
};

/**
 * Make client-controlled text safe to put inside a log line: line breaks and
 * tabs become the visible escapes `\r`, `\n`, `\t`, other control characters
 * (including NUL, DEL, C1 controls and the Unicode line/paragraph separators)
 * become `\uXXXX`, and ANSI terminal escape sequences are removed.
 *
 * Without it, a user agent or form field containing `\n2026-01-01 [info] …`
 * writes a forged entry into a text log, and an ANSI sequence can rewrite what
 * a terminal shows. Structured channels (JSON) are not affected, but console
 * and file channels are.
 *
 * @example
 * log.info("auth", "login", `Login from ${escapeLogValue(request.userAgent)}`);
 */
export function escapeLogValue(value: unknown, options: EscapeLogValueOptions = {}): string {
  let text = typeof value === "string" ? value : String(value);

  const maxLength = options.maxLength;
  let truncated = false;
  if (maxLength !== undefined && maxLength >= 0 && text.length > maxLength) {
    text = text.slice(0, maxLength);
    truncated = true;
  }

  const escaped = text
    .replace(ANSI_ESCAPE, "")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(CONTROL, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

  return truncated ? `${escaped}…[truncated]` : escaped;
}
