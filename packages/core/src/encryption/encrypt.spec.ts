import config from "@mongez/config";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./encrypt";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

beforeEach(() => {
  config.set("encryption.key", KEY);
  config.set("encryption.algorithm", "aes-256-gcm");
  config.set("encryption.previousKeys", undefined);
});

describe("decrypt() tag and IV lengths", () => {
  it("rejects a truncated auth tag", () => {
    const [iv, body, tag] = encrypt("trust-me").split(":") as [string, string, string];

    for (const bytes of [4, 8, 12]) {
      expect(() => decrypt(`${iv}:${body}:${tag.slice(0, bytes * 2)}`)).toThrow(
        "Decryption failed",
      );
    }
  });

  it("rejects an IV that is not 16 bytes", () => {
    const [iv, body, tag] = encrypt("trust-me").split(":") as [string, string, string];

    expect(() => decrypt(`${iv.slice(0, 24)}:${body}:${tag}`)).toThrow("Decryption failed");
  });

  it("still decrypts what encrypt() produces", () => {
    expect(decrypt(encrypt("round-trip"))).toBe("round-trip");
  });
});

describe("decrypt() with previous keys", () => {
  const OLD_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
  const OTHER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("opens a value encrypted with a retired key", () => {
    config.set("encryption.key", OLD_KEY);
    const stored = encrypt("before-rotation");

    config.set("encryption.key", KEY);
    config.set("encryption.previousKeys", [OTHER_KEY, OLD_KEY]);

    expect(decrypt(stored)).toBe("before-rotation");
  });

  it("encrypts with the current key only", () => {
    config.set("encryption.previousKeys", [OLD_KEY]);
    const stored = encrypt("after-rotation");

    config.set("encryption.key", OLD_KEY);
    config.set("encryption.previousKeys", undefined);

    expect(() => decrypt(stored)).toThrow("Decryption failed");
  });

  it("refuses a value encrypted with a key that is not configured", () => {
    config.set("encryption.key", OTHER_KEY);
    const stored = encrypt("stranger");

    config.set("encryption.key", KEY);
    config.set("encryption.previousKeys", [OLD_KEY]);

    expect(() => decrypt(stored)).toThrow("Decryption failed");
  });

  it("refuses a tampered value even when previous keys are set", () => {
    config.set("encryption.key", OLD_KEY);
    const [iv, body, tag] = encrypt("tamper-me").split(":") as [string, string, string];
    const flipped = (body[0] === "0" ? "1" : "0") + body.slice(1);

    config.set("encryption.key", KEY);
    config.set("encryption.previousKeys", [OLD_KEY]);

    expect(() => decrypt(`${iv}:${flipped}:${tag}`)).toThrow("Decryption failed");
  });

  it("rejects a malformed previous key without echoing it", () => {
    config.set("encryption.previousKeys", ["abcd"]);

    const attempt = () => decrypt(encrypt("x"));

    expect(attempt).toThrow("encryption.previousKeys[0]");
    expect(attempt).not.toThrow("abcd");
  });
});
