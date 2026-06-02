import config from "@mongez/config";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, hmacHash } from "../../../src/encryption";

// Fixed 32-byte (64 hex char) keys so HMAC assertions are deterministic.
const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const HMAC_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

beforeEach(() => {
  config.set("encryption.key", KEY);
  config.set("encryption.hmacKey", HMAC_KEY);
  config.set("encryption.algorithm", "aes-256-gcm");
});

describe("encrypt / decrypt (AES-256-GCM)", () => {
  it("round-trips a plaintext string", () => {
    const cipher = encrypt("sk-proj-12345");

    expect(cipher).not.toBe("sk-proj-12345");
    expect(decrypt(cipher)).toBe("sk-proj-12345");
  });

  it("round-trips unicode and long input", () => {
    const text = "héllo-世界-".repeat(200);

    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("produces iv:ciphertext:authTag in hex", () => {
    const parts = encrypt("payload").split(":");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/); // 16-byte GCM auth tag
  });

  it("is non-deterministic — a fresh IV per call", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("returns falsy input unchanged", () => {
    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });

  it("throws on a malformed ciphertext", () => {
    expect(() => decrypt("not-a-valid-token")).toThrow(/Decryption failed/);
  });

  it("detects tampering via the auth tag", () => {
    const [iv, body, tag] = encrypt("trust-me").split(":");
    const flipped = body.slice(0, -1) + (body.endsWith("a") ? "b" : "a");

    expect(() => decrypt(`${iv}:${flipped}:${tag}`)).toThrow(/Decryption failed/);
  });

  it("rejects a key of the wrong byte length", () => {
    config.set("encryption.key", "abcd"); // 2 bytes, not 32

    expect(() => encrypt("x")).toThrow(/must be exactly 32 bytes/);
  });

  it("throws when the key is missing", () => {
    config.set("encryption.key", "");

    expect(() => encrypt("x")).toThrow(/Missing encryption key/);
  });
});

describe("hmacHash (HMAC-SHA256)", () => {
  it("is deterministic for the same input", () => {
    expect(hmacHash("api-key")).toBe(hmacHash("api-key"));
  });

  it("returns a 64-char hex digest", () => {
    expect(hmacHash("api-key")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hmacHash("a")).not.toBe(hmacHash("b"));
  });

  it("returns falsy input unchanged", () => {
    expect(hmacHash("")).toBe("");
  });

  it("falls back to encryption.key when hmacKey is absent", () => {
    const withHmacKey = hmacHash("x");

    config.set("encryption.hmacKey", "");

    const withFallback = hmacHash("x");

    expect(withFallback).toMatch(/^[0-9a-f]{64}$/);
    expect(withFallback).not.toBe(withHmacKey); // different key → different digest
  });

  it("throws when neither hmacKey nor key is set", () => {
    config.set("encryption.hmacKey", "");
    config.set("encryption.key", "");

    expect(() => hmacHash("x")).toThrow(/Missing HMAC key/);
  });
});
