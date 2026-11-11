import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const DIGITS = "0123456789";
const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Generate a one-time code from the operating system's secure random source.
 * Every character is drawn independently, so a 6-digit code has 1,000,000
 * equally likely values (leading zeros included).
 */
export function generateOtpCode(length: number = 6, alphanumeric: boolean = false): string {
  const alphabet = alphanumeric ? ALPHANUMERIC : DIGITS;
  let code = "";

  for (let index = 0; index < length; index++) {
    code += alphabet.charAt(randomInt(alphabet.length));
  }

  return code;
}

/**
 * The stored form of a code: an HMAC-SHA256 keyed by an app secret and bound
 * to the code's target and purpose. A plain hash of a 6-digit code is reversed
 * by trying all million values, so the secret key is what keeps a leaked
 * `otps` table useless.
 */
export function hashOtpCode(key: string, target: string, type: string, code: string): string {
  return createHmac("sha256", key).update(`${type}:${target}:${code}`).digest("hex");
}

/** Compare a submitted code with the stored hash in constant time. */
export function otpCodeMatches(
  key: string,
  storedHash: string,
  target: string,
  type: string,
  code: string,
): boolean {
  const expected = Buffer.from(hashOtpCode(key, target, type, code), "hex");
  const stored = Buffer.from(storedHash, "hex");

  return stored.length === expected.length && timingSafeEqual(stored, expected);
}
