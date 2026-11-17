/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30-second
 * steps): the codes authenticator apps show. Secrets are base32 (RFC 4648,
 * no padding). Pure functions over `node:crypto`; no config is read.
 *
 * Owner: devtools 5.56 WP-2.
 */

/** Options shared by the TOTP helpers. */
export type TotpOptions = {
  /** Seconds per step. @default 30 */
  period?: number;
  /** Code length. @default 6 */
  digits?: number;
};

/** A new random secret, base32, from `bytes` random bytes (default 20 = 160 bits). */
export function generateTotpSecret(_bytes = 20): string {
  throw new Error("not implemented");
}

/** The code for `secret` at time `at` (epoch ms, default now). */
export function totpCode(
  _secret: string,
  _at: number = Date.now(),
  _options: TotpOptions = {},
): string {
  throw new Error("not implemented");
}

/**
 * Checks `code` against the steps from `at - window` to `at + window`
 * (default window 1) with a constant-time compare. Returns the matched time
 * step (store it and refuse a later code from the same or an earlier step,
 * so a code cannot be replayed), or `null`.
 */
export function verifyTotp(
  _secret: string,
  _code: string,
  _options: TotpOptions & { at?: number; window?: number } = {},
): number | null {
  throw new Error("not implemented");
}

/** The `otpauth://totp/<issuer>:<account>?secret=…&issuer=…` URI an authenticator app scans as a QR code. */
export function totpUri(
  _input: { secret: string; account: string; issuer: string } & TotpOptions,
): string {
  throw new Error("not implemented");
}
