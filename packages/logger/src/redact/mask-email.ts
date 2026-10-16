/**
 * Email addresses inside free text: a local part and a dotted domain, letters
 * and digits from any script (`jöhn@exämple.de`). Kept deliberately simple (no
 * quoted local parts, no IP-literal domains, no percent-encoded `@`): it masks
 * the addresses that show up in log messages and cache keys, not every string
 * RFC 5322 allows.
 *
 * Every repetition is bounded (local part 64, label 63, at most 12 labels), so
 * matching stays linear in the input length. Cache keys and messages are often
 * built from request input; an unbounded pattern backtracks quadratically on a
 * long run of address-like characters with no domain.
 */
const EMAIL_IN_TEXT =
  /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,10}\.\p{L}{2,63}/gu;

/**
 * Longest text {@link maskEmailsInText} scans. Anything past it is cut off and
 * replaced by a marker, so a huge cache key or message cannot cost more than a
 * bounded amount of time per log line, and nothing past the cut can leak.
 */
export const MASK_EMAILS_MAX_LENGTH = 16_384;

/**
 * Mask one email address, keeping its first character and its domain:
 * `member@example.com` → `m***@example.com`. A value without an `@` is
 * returned as `***`.
 *
 * Key-based redaction cannot reach an address that sits inside a message
 * string or a cache key; mask it before it is logged.
 *
 * @example
 * log.info("mail", "send", `Sending mail to: ${maskEmail(to)}`);
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");

  if (at <= 0) return "***";

  // The first code point, not the first UTF-16 unit: never half an emoji.
  const first = String.fromCodePoint(address.codePointAt(0)!);

  return `${first}***${address.slice(at)}`;
}

/**
 * Mask every email address the pattern above recognises in a piece of text
 * with {@link maskEmail}. Text longer than {@link MASK_EMAILS_MAX_LENGTH}
 * characters is truncated first (the cut is marked).
 *
 * Dots are valid in the local part of an address, so a dotted prefix that
 * runs into the address is masked with it: in a cache key such as
 * `email.member@example.com` the whole `email.member` reads as the local part.
 *
 * Not recognised (left as they are): quoted local parts (`"john doe"@x.com`),
 * IP-literal domains (`user@[127.0.0.1]`) and percent-encoded addresses
 * (`user%40example.com`).
 *
 * @example
 * maskEmailsInText("sent to member@example.com") // "sent to m***@example.com"
 * maskEmailsInText("email.member@example.com") // "e***@example.com"
 */
export function maskEmailsInText(text: string): string {
  let scanned = text;
  let marker = "";

  if (scanned.length > MASK_EMAILS_MAX_LENGTH) {
    let cut = MASK_EMAILS_MAX_LENGTH;
    const last = scanned.charCodeAt(cut - 1);

    // Never end on the first half of a surrogate pair.
    if (last >= 0xd800 && last <= 0xdbff) cut -= 1;

    marker = `…[${scanned.length - cut} chars truncated]`;
    scanned = scanned.slice(0, cut);
  }

  if (!scanned.includes("@")) return scanned + marker;

  return scanned.replace(EMAIL_IN_TEXT, (match) => maskEmail(match)) + marker;
}
