/**
 * Configuration for the encryption module.
 *
 * @example
 * // src/config/encryption.ts
 * import type { EncryptionConfigurations } from "@warlock.js/core";
 * import { env } from "@warlock.js/core";
 *
 * const encryptionConfig: EncryptionConfigurations = {
 *   key: env("APP_ENCRYPTION_KEY"),
 *   algorithm: "aes-256-gcm",
 *   hmacKey: env("APP_HMAC_KEY"),
 *   password: {
 *     salt: 12,
 *   },
 * };
 *
 * export default encryptionConfig;
 */
export type EncryptionConfigurations = {
  /**
   * 32-byte hex-encoded encryption key (64 hex characters).
   * Used by encrypt() and decrypt().
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  key: string;

  /**
   * Retired encryption keys (same hex format as `key`), newest first.
   * `decrypt()` tries them, in order, only when `key` fails to open a value;
   * `encrypt()` always uses `key`. Remove a key once nothing stored is still
   * encrypted with it.
   */
  previousKeys?: string[];

  /**
   * Encryption algorithm to use.
   * Defaults to "aes-256-gcm" if not set.
   */
  algorithm?: string;

  /**
   * Separate HMAC key (hex-encoded) for hmacHash().
   * Falls back to `key` if not provided.
   * Best practice: keep these separate.
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  hmacKey?: string;

  /**
   * Password hashing configuration (bcrypt).
   */
  password?: EncryptionPasswordConfigurations;
};

export type EncryptionPasswordConfigurations = {
  /**
   * Hashing algorithm for new hashes. Both formats always verify, whatever
   * this is set to, so switching never locks anyone out.
   *
   * - `"bcrypt"` — bcrypt, cost from `salt`.
   * - `"scrypt"` — scrypt on `node:crypto` (runs on the thread pool, needs no
   *   extra dependency, has no 72-byte password limit), parameters from `scrypt`.
   * @default "bcrypt"
   */
  driver?: "bcrypt" | "scrypt";

  /**
   * scrypt parameters, used when `driver` is `"scrypt"`. Hashes made with other
   * parameters still verify and report `needsRehash()`.
   */
  scrypt?: {
    /** CPU/memory cost `N`, a power of two. @default 32768 */
    cost?: number;
    /** Block size `r`. @default 8 */
    blockSize?: number;
    /** Parallelization `p`. @default 1 */
    parallelization?: number;
  };

  /**
   * bcrypt salt rounds. Higher = slower and more secure.
   * 10–12 is the standard range. Defaults to 12.
   */
  salt?: number;

  /**
   * bcrypt uses only the first 72 bytes (UTF-8) of a password. When `true`,
   * `hashPassword()` throws for a longer password instead of hashing its
   * first 72 bytes. When `false`, a longer password is hashed as before and a
   * one-time warning is logged.
   * @default false
   */
  rejectLongPasswords?: boolean;
};
