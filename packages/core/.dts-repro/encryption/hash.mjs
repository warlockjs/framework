import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import crypto from "crypto";
//#region ../../@warlock.js/core/src/encryption/hash.ts
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
function hmacHash(plainText) {
	if (!plainText) return plainText;
	const hmacKey = config.key("encryption.hmacKey") || config.key("encryption.key");
	if (!hmacKey) throw new Error("Missing HMAC key. Set 'encryption.hmacKey' (or 'encryption.key') in your config.");
	const keyBuffer = Buffer.from(hmacKey, "hex");
	return crypto.createHmac("sha256", keyBuffer).update(plainText).digest("hex");
}
//#endregion
export { hmacHash };

//# sourceMappingURL=hash.mjs.map