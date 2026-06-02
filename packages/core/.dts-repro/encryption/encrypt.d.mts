//#region ../../@warlock.js/core/src/encryption/encrypt.d.ts
/**
 * Encrypts a plaintext string using AES-256-GCM (or the configured algorithm).
 * Returns a combined string in the format `iv:ciphertext:authTag`.
 *
 * @example
 * import { encrypt } from "@warlock.js/core";
 *
 * const encrypted = encrypt("sk-proj-12345");
 * // => "a1b2c3...:d4e5f6...:g7h8i9..."
 */
declare function encrypt(plainText: string): string;
/**
 * Decrypts a string previously encrypted with {@link encrypt}.
 * Expects the format `iv:ciphertext:authTag`.
 *
 * @example
 * import { decrypt } from "@warlock.js/core";
 *
 * const original = decrypt(encryptedString);
 * // => "sk-proj-12345"
 */
declare function decrypt(cipherText: string): string;
//#endregion
export { decrypt, encrypt };
//# sourceMappingURL=encrypt.d.mts.map