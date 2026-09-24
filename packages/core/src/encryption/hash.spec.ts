import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { hmacHash } from "./hash";

describe("hmacHash key validation", () => {
  afterEach(() => {
    config.set("encryption", {});
  });

  it("throws for a non-hex hmacKey instead of using an empty key", () => {
    config.set("encryption", { hmacKey: "not-a-hex-key-at-all-not-a-hex-key!" });

    expect(() => hmacHash("sk-proj-12345")).toThrow(/openssl rand -hex 32/);
  });

  it("throws for an odd-length or too-short hex key", () => {
    config.set("encryption", { hmacKey: "abc" });
    expect(() => hmacHash("x")).toThrow(/hmacKey/);

    config.set("encryption", { hmacKey: "abcd" });
    expect(() => hmacHash("x")).toThrow(/hmacKey/);
  });

  it("still hashes with a valid hex key, deterministically", () => {
    config.set("encryption", { hmacKey: "a".repeat(64) });

    expect(hmacHash("x")).toBe(hmacHash("x"));
    expect(hmacHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
