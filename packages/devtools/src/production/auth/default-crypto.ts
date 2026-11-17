import type { DevtoolsCrypto } from "./types";

/** Core's password hashing, encryption and TOTP helpers, loaded lazily. */
export async function defaultDevtoolsCrypto(): Promise<DevtoolsCrypto> {
  const core = await import("@warlock.js/core");

  return {
    hashPassword: (password) => core.hashPassword(password),
    verifyPassword: (password, hash) => core.verifyPassword(password, hash),
    encrypt: (plain) => core.encrypt(plain),
    decrypt: (cipher) => core.decrypt(cipher),
    generateTotpSecret: () => core.generateTotpSecret(),
    verifyTotp: (secret, code, at) => core.verifyTotp(secret, code, { at }),
    totpUri: (input) => core.totpUri(input),
    hmac: (value) => core.hmacHash(value),
  };
}
