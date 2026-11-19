import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { DevtoolsErrorCode } from "../contracts";
import { COMMON_PASSWORDS } from "./common-passwords";

/** The lowest `passwords.minLength` the options accept, and its default. */
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

/** The alphabet of recovery codes and references: no 0, 1, 8, 9, I, L, O. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Letters and digits that cannot be mistaken for each other. */
const TEMPORARY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * The password rules: at least `rules.minLength` characters (default 8), at
 * most 72 bytes (UTF-8), not in the built-in common list unless
 * `rules.rejectCommon` is false (compared lower-cased), not equal to the email
 * (lower-cased). Returns the failing rule's error code, or `null`.
 */
export function checkPasswordPolicy(
  password: string,
  email: string | null,
  rules: { minLength?: number; rejectCommon?: boolean } = {},
): DevtoolsErrorCode | null {
  const minLength = rules.minLength ?? MIN_PASSWORD_LENGTH;

  if (typeof password !== "string" || [...password].length < minLength) {
    return "auth.password-too-short";
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return "auth.password-too-long";

  const lower = password.toLowerCase();

  if (rules.rejectCommon !== false && COMMON_PASSWORDS.has(lower)) return "auth.password-common";

  if (email !== null && lower === email.trim().toLowerCase()) return "auth.password-same-as-email";

  return null;
}

/** 32 random bytes, base64url (43 characters): session, CSRF and invite tokens. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a token: what the store keeps. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A random temporary password for `warlock devtools:reset-admin`: 20
 * characters from an unambiguous alphabet, passes `checkPasswordPolicy`.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    let password = "";

    for (let index = 0; index < 20; index++) {
      password += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)];
    }

    if (checkPasswordPolicy(password, null) === null) return password;
  }
}

/** Compares two strings in constant time (both are hashed first, so lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();

  return timingSafeEqual(left, right);
}

/** Emails are compared trimmed and lower-cased. */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** A deliberately plain shape check; the invite flow is the real proof of ownership. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** One recovery code, `xxxxx-xxxxx` from the unambiguous alphabet. */
export function generateRecoveryCode(): string {
  let code = "";

  for (let index = 0; index < 10; index++) {
    if (index === 5) code += "-";

    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }

  return code;
}

/** The form a recovery code is hashed in: upper case, letters and digits only. */
export function normalizeRecoveryCode(code: string): string {
  return String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 hex of a normalized recovery code. */
export function hashRecoveryCode(code: string): string {
  return hashToken(normalizeRecoveryCode(code));
}
