import config from "@mongez/config";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./encrypt";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

beforeEach(() => {
  config.set("encryption.key", KEY);
  config.set("encryption.algorithm", "aes-256-gcm");
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
