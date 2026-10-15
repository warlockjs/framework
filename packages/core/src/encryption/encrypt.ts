import crypto from "crypto";
import { config } from "../config";
import { type EncryptionConfigurations } from "./types";

/**
 * Default encryption algorithm.
 */
const DEFAULT_ALGORITHM = "aes-256-gcm";

/**
 * Get the encryption key from config, validated as a 32-byte hex string.
 */
function getEncryptionKey(keyBytes: number): Buffer {
  const key = config.key<EncryptionConfigurations["key"]>("encryption.key");

  if (!key) {
    throw new Error(
      "Missing encryption key. Set 'encryption.key' in your config (64 hex characters = 32 bytes).",
    );
  }

  const buffer = Buffer.from(key, "hex");

  if (buffer.length !== keyBytes) {
    // Never include the key itself: this message reaches logs and error pages.
    throw new Error(
      `Encryption key must be exactly ${keyBytes} bytes (${keyBytes * 2} hex characters). Got ${buffer.length} bytes.`,
    );
  }

  return buffer;
}

/**
 * Supported algorithms (the format assumes GCM: 16-byte IV + auth tag)
 * mapped to their required key size in bytes.
 */
const ALGORITHM_KEY_BYTES: Record<string, number> = {
  "aes-128-gcm": 16,
  "aes-192-gcm": 24,
  "aes-256-gcm": 32,
};

/**
 * Get the configured encryption algorithm, defaults to aes-256-gcm.
 */
function getAlgorithm(): string {
  const algorithm = config.key<EncryptionConfigurations["algorithm"]>(
    "encryption.algorithm",
    DEFAULT_ALGORITHM,
  )!;

  if (!(algorithm in ALGORITHM_KEY_BYTES)) {
    throw new Error(
      `Unsupported encryption algorithm '${algorithm}'. Supported: ${Object.keys(ALGORITHM_KEY_BYTES).join(", ")}.`,
    );
  }

  return algorithm;
}

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
export function encrypt(plainText: string): string {
  if (!plainText) return plainText;

  const algorithm = getAlgorithm();
  const keyBuffer = getEncryptionKey(ALGORITHM_KEY_BYTES[algorithm]!);

  try {
    // IV must be unique per encryption. 16 bytes is standard for AES.
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Auth tag validates ciphertext integrity (tamper detection)
    const authTag = (cipher as crypto.CipherGCM).getAuthTag().toString("hex");

    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
  } catch (error) {
    throw new Error(`Encryption failed: ${(error as Error).message}`);
  }
}

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
export function decrypt(cipherText: string): string {
  if (!cipherText) return cipherText;

  const algorithm = getAlgorithm();
  const keyBuffer = getEncryptionKey(ALGORITHM_KEY_BYTES[algorithm]!);

  try {
    const parts = cipherText.split(":");

    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format. Expected iv:ciphertext:authTag");
    }

    const [ivHex, encryptedHex, authTagHex] = parts;

    if (ivHex === undefined || encryptedHex === undefined || authTagHex === undefined) {
      throw new Error("Invalid encrypted format. Expected iv:ciphertext:authTag");
    }

    const decipher = crypto.createDecipheriv(algorithm, keyBuffer, Buffer.from(ivHex, "hex"));

    (decipher as crypto.DecipherGCM).setAuthTag(Buffer.from(authTagHex, "hex"));

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    // .final() throws if auth tag is invalid (data tampered)
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}
