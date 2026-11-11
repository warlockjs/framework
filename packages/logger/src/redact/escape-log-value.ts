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

/**
 * Every terminal escape: CSI, OSC (`ESC ] … BEL` or `ESC ] … ESC \`), the
 * two-character `ESC x` escapes and a lone ESC. Bounded so matching stays linear.
 */
const TERMINAL_ESCAPE =
  // oxlint-disable-next-line eslint/no-control-regex -- matching terminal escapes is the point.
  /\u001b(?:\[[0-?]{0,32}[ -/]{0,8}[@-~]|\][^\u0007\u001b]{0,4096}(?:\u0007|\u001b\\)?|[0-~])?/g;

/** A colour/style sequence (SGR): `ESC [ <digits and ;> m`. */
// oxlint-disable-next-line eslint/no-control-regex -- matching terminal escapes is the point.
const SGR = /^\u001b\[([0-9;]{0,32})m$/;

/** Control characters other than `\n`, `\r`, `\t` and ESC (handled above). */
// oxlint-disable-next-line eslint/no-control-regex -- escaping control characters is the point.
const TERMINAL_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g;

/**
 * Whether an SGR parameter list turns on "conceal" (`8`), which hides the text
 * that follows. The arguments of extended colours (`38;5;n`, `48;2;r;g;b`)
 * are skipped so a colour number is never read as a style.
 */
function concealsText(parameters: string): boolean {
  const codes = parameters.split(";").map(Number);

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];

    if (code === 38 || code === 48 || code === 58) {
      index += codes[index + 1] === 2 ? 4 : 2;
      continue;
    }

    if (code === 8) return true;
  }

  return false;
}

/**
 * Make message text safe to print on a terminal while keeping its colours:
 * colour and style codes stay (the framework colours parts of its own
 * messages), every other escape sequence is removed (cursor movement, screen
 * clearing, window titles, clipboard writes, the "conceal" style), and
 * control characters other than line breaks and tabs become `\uXXXX`.
 *
 * Line breaks are kept; {@link escapeLogValue} is the stricter form that also
 * escapes them.
 *
 * @internal Used by the console and file channels.
 */
export function neutralizeTerminalText(text: string): string {
  return text
    .replace(TERMINAL_ESCAPE, (sequence) => {
      const match = SGR.exec(sequence);

      return match && !concealsText(match[1] ?? "") ? sequence : "";
    })
    .replace(TERMINAL_CONTROL, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
