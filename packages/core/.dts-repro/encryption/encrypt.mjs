import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import crypto from "crypto";
//#region ../../@warlock.js/core/src/encryption/encrypt.ts
/**
* Default encryption algorithm.
*/
const DEFAULT_ALGORITHM = "aes-256-gcm";
/**
* Get the encryption key from config, validated as a 32-byte hex string.
*/
function getEncryptionKey() {
	const key = config.key("encryption.key");
	if (!key) throw new Error("Missing encryption key. Set 'encryption.key' in your config (64 hex characters = 32 bytes).");
	const buffer = Buffer.from(key, "hex");
	if (buffer.length !== 32) throw new Error(`Encryption key must be exactly 32 bytes (64 hex characters). Got ${buffer.length} bytes for key ${key}.`);
	return buffer;
}
/**
* Get the configured encryption algorithm, defaults to aes-256-gcm.
*/
function getAlgorithm() {
	return config.key("encryption.algorithm", DEFAULT_ALGORITHM);
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
function encrypt(plainText) {
	if (!plainText) return plainText;
	const keyBuffer = getEncryptionKey();
	const algorithm = getAlgorithm();
	try {
		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
		let encrypted = cipher.update(plainText, "utf8", "hex");
		encrypted += cipher.final("hex");
		const authTag = cipher.getAuthTag().toString("hex");
		return `${iv.toString("hex")}:${encrypted}:${authTag}`;
	} catch (error) {
		throw new Error(`Encryption failed: ${error.message}`);
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
function decrypt(cipherText) {
	if (!cipherText) return cipherText;
	const keyBuffer = getEncryptionKey();
	const algorithm = getAlgorithm();
	try {
		const parts = cipherText.split(":");
		if (parts.length !== 3) throw new Error("Invalid encrypted format. Expected iv:ciphertext:authTag");
		const [ivHex, encryptedHex, authTagHex] = parts;
		const decipher = crypto.createDecipheriv(algorithm, keyBuffer, Buffer.from(ivHex, "hex"));
		decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
		let decrypted = decipher.update(encryptedHex, "hex", "utf8");
		decrypted += decipher.final("utf8");
		return decrypted;
	} catch (error) {
		throw new Error(`Decryption failed: ${error.message}`);
	}
}
//#endregion
export { decrypt, encrypt };

//# sourceMappingURL=encrypt.mjs.map