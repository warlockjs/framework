//#region ../../@warlock.js/core/src/encryption/hash.d.ts
/**
 * Creates a deterministic HMAC-SHA256 hash of the given string.
 *
 * Useful for creating searchable, unique fingerprints of sensitive data
 * (e.g., an API key) without storing the plaintext.
 *
 * Uses a dedicated HMAC key from config. Falls back to the encryption key
 * if no separate HMAC key is configured.
 *
 * @example
 * import { hmacHash } from "@warlock.js/core";
 *
 * const fingerprint = hmacHash("sk-proj-12345");
 * // Store `fingerprint` in DB for lookups, store encrypted value separately
 */
declare function hmacHash(plainText: string): string;
//#endregion
export { hmacHash };
//# sourceMappingURL=hash.d.mts.map