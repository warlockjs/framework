import crypto from "crypto";
import { config } from "../config";
import { type EncryptionConfigurations } from "./types";

const MIN_HMAC_KEY_BYTES = 16;

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
export function hmacHash(plainText: string): string {
  if (!plainText) return plainText;

  const hmacKey =
    config.key<EncryptionConfigurations["hmacKey"]>("encryption.hmacKey") ||
    config.key<EncryptionConfigurations["key"]>("encryption.key");

  if (!hmacKey) {
    throw new Error(
      "Missing HMAC key. Set 'encryption.hmacKey' (or 'encryption.key') in your config.",
    );
  }

  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hmacKey) || hmacKey.length / 2 < MIN_HMAC_KEY_BYTES) {
    throw new Error(
      "Invalid HMAC key. 'encryption.hmacKey' (or 'encryption.key') must be an even-length hex string of at least 16 bytes. Generate one with: openssl rand -hex 32",
    );
  }

  const keyBuffer = Buffer.from(hmacKey, "hex");

  return crypto.createHmac("sha256", keyBuffer).update(plainText).digest("hex");
}
