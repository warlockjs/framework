//#region ../../@warlock.js/core/src/encryption/password.d.ts
/**
 * Hashes a password using bcrypt (async — does not block the event loop).
 *
 * Salt rounds are read from \`encryption.password.saltRounds\` config,
 * defaulting to 12.
 *
 * @example
 * import { hashPassword } from "@warlock.js/core";
 *
 * const hashed = await hashPassword("user-password-123");
 * // Store \`hashed\` in the database
 */
declare function hashPassword(password: string): Promise<string>;
/**
 * Verifies a plain password against a bcrypt hash (async — does not block the event loop).
 *
 * @example
 * import { verifyPassword } from "@warlock.js/core";
 *
 * const isValid = await verifyPassword("user-password-123", storedHash);
 */
declare function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean>;
//#endregion
export { hashPassword, verifyPassword };
//# sourceMappingURL=password.d.mts.map