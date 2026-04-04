import { compare, hash } from "bcryptjs";
import { config } from "../config";
import { EncryptionPasswordConfigurations } from "./types";

/**
 * Default bcrypt salt rounds.
 */
const DEFAULT_SALT_ROUNDS = 12;

/**
 * Hashes a password using bcrypt (async — does not block the event loop).
 *
 * Salt rounds are read from `encryption.password.saltRounds` config,
 * defaulting to 12.
 *
 * @example
 * import { hashPassword } from "@warlock.js/core";
 *
 * const hashed = await hashPassword("user-password-123");
 * // Store `hashed` in the database
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = config.key<EncryptionPasswordConfigurations["salt"]>(
    "encryption.password.salt",
    DEFAULT_SALT_ROUNDS,
  )!;

  return hash(String(password), saltRounds);
}

/**
 * Verifies a plain password against a bcrypt hash (async — does not block the event loop).
 *
 * @example
 * import { verifyPassword } from "@warlock.js/core";
 *
 * const isValid = await verifyPassword("user-password-123", storedHash);
 */
export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  return compare(String(plainPassword), String(hashedPassword));
}
