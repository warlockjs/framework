import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30-second
 * steps): the codes authenticator apps show. Secrets are base32 (RFC 4648,
 * no padding). Pure functions over `node:crypto`; no config is read.
 */

/** Options shared by the TOTP helpers. */
export type TotpOptions = {
  /** Seconds per step. @default 30 */
  period?: number;
  /** Code length. @default 6 */
  digits?: number;
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

/** Decodes base32, case-insensitive; spaces, dashes and padding are ignored. Throws on any other character. */
function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);

    if (index === -1) throw new Error("The TOTP secret is not valid base32.");

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** A new random secret, base32, from `bytes` random bytes (default 20 = 160 bits). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function codeForStep(key: Buffer, step: number, digits: number): string {
  const counter = Buffer.alloc(8);

  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

function stepAt(at: number, period: number): number {
  return Math.floor(at / 1000 / period);
}

/** The code for `secret` at time `at` (epoch ms, default now). */
export function totpCode(
  secret: string,
  at: number = Date.now(),
  options: TotpOptions = {},
): string {
  const { period = 30, digits = 6 } = options;

  return codeForStep(base32Decode(secret), stepAt(at, period), digits);
}

/**
 * Checks `code` against the steps from `at - window` to `at + window`
 * (default window 1) with a constant-time compare. Returns the matched time
 * step (store it and refuse a later code from the same or an earlier step,
 * so a code cannot be replayed), or `null`.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: TotpOptions & { at?: number; window?: number } = {},
): number | null {
  const { period = 30, digits = 6, at = Date.now(), window = 1 } = options;
  const given = String(code).replace(/\s/g, "");

  if (!new RegExp(`^\\d{${digits}}$`).test(given)) return null;

  let key: Buffer;

  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }

  const current = stepAt(at, period);
  const givenBuffer = Buffer.from(given);
  let matched: number | null = null;

  // Every step is checked, so the time taken does not tell which one matched.
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;

    const expected = Buffer.from(codeForStep(key, step, digits));

    if (timingSafeEqual(givenBuffer, expected) && matched === null) matched = step;
  }

  return matched;
}

/** The `otpauth://totp/<issuer>:<account>?secret=…&issuer=…` URI an authenticator app scans as a QR code. */
export function totpUri(
  input: { secret: string; account: string; issuer: string } & TotpOptions,
): string {
  const { secret, account, issuer, period = 30, digits = 6 } = input;
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query =
    `secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${digits}&period=${period}`;

  return `otpauth://totp/${label}?${query}`;
}
