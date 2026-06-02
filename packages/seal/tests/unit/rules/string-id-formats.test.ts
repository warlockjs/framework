import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { matchesRule } from "../../../src/rules/string/matches";

/**
 * Coverage for the string ID-format rules (uuid/cuid/ulid/nanoid), the
 * strongPassword rule, and the standalone matches cross-field rule — none of
 * which the base string-rules suite touches.
 *
 * Patterns and edge cases are taken straight from id-formats.ts and
 * strong-password-rule.ts so the fixtures match the real regexes.
 */

describe("String ID format rules", () => {
  describe("uuid", () => {
    it("accepts any RFC-4122 UUID without a version constraint", async () => {
      const validator = v.string().uuid();
      expect((await validate(validator, "550e8400-e29b-41d4-a716-446655440000")).isValid).toBe(
        true,
      );
      // v1 UUID still passes the any-version check
      expect((await validate(validator, "a8098c1a-f86e-11da-bd1a-00112444be1e")).isValid).toBe(
        true,
      );
      expect((await validate(validator, "not-a-uuid")).isValid).toBe(false);
      expect((await validate(validator, "550e8400e29b41d4a716446655440000")).isValid).toBe(false);
    });

    it("restricts to a specific version when one is given", async () => {
      const v4 = v.string().uuid(4);
      expect((await validate(v4, "550e8400-e29b-41d4-a716-446655440000")).isValid).toBe(true);
      // version nibble is 1, not 4 → fails the v4 constraint
      expect((await validate(v4, "a8098c1a-f86e-11da-bd1a-00112444be1e")).isValid).toBe(false);

      const v7 = v.string().uuid(7);
      expect((await validate(v7, "017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).isValid).toBe(true);
      expect((await validate(v7, "550e8400-e29b-41d4-a716-446655440000")).isValid).toBe(false);
    });

    it("rejects non-string input", async () => {
      // mutable any-validator routed through the uuid rule with a number value
      const result = await validate(v.string().uuid(), 12345);
      expect(result.isValid).toBe(false);
    });
  });

  describe("cuid", () => {
    it("defaults to CUID2 shape (24 chars, lowercase, starts with a letter)", async () => {
      const validator = v.string().cuid();
      expect((await validate(validator, "tz4a98xxat96iws9zmbrgj3a")).isValid).toBe(true);
      // starts with a digit → invalid for CUID2
      expect((await validate(validator, "1z4a98xxat96iws9zmbrgj3a")).isValid).toBe(false);
      // too short
      expect((await validate(validator, "abc")).isValid).toBe(false);
    });

    it("accepts legacy CUID1 when version 1 is requested", async () => {
      const validator = v.string().cuid({ version: 1 });
      expect((await validate(validator, "cjld2cjxh0000qzrmn831i7rn")).isValid).toBe(true);
      // CUID1 must start with "c"
      expect((await validate(validator, "xjld2cjxh0000qzrmn831i7rn")).isValid).toBe(false);
    });
  });

  describe("ulid", () => {
    it("accepts a 26-char Crockford base32 string", async () => {
      const validator = v.string().ulid();
      expect((await validate(validator, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).isValid).toBe(true);
      // contains excluded letter "I"
      expect((await validate(validator, "01ARZ3NDEKTSV4RRFFQ69G5FAI")).isValid).toBe(false);
      // wrong length
      expect((await validate(validator, "01ARZ3NDEK")).isValid).toBe(false);
    });
  });

  describe("nanoid", () => {
    it("defaults to length 21 with the URL-safe alphabet", async () => {
      const validator = v.string().nanoid();
      expect((await validate(validator, "V1StGXR8_Z5jdHi6B-myT")).isValid).toBe(true);
      // 20 chars → too short for default
      expect((await validate(validator, "V1StGXR8_Z5jdHi6B-myA".slice(0, 20))).isValid).toBe(false);
    });

    it("honors a custom length", async () => {
      const validator = v.string().nanoid(10);
      expect((await validate(validator, "abc123_-XY")).isValid).toBe(true);
      expect((await validate(validator, "abc123_-XYZ")).isValid).toBe(false); // 11 chars
    });
  });
});

describe("strongPassword rule", () => {
  it("requires length, upper, lower, number, and special character", async () => {
    const validator = v.string().strongPassword();
    expect((await validate(validator, "Abcdef1!")).isValid).toBe(true);
    expect((await validate(validator, "short1!A")).isValid).toBe(true); // exactly 8

    expect((await validate(validator, "abcdef1!")).isValid).toBe(false); // no uppercase
    expect((await validate(validator, "ABCDEF1!")).isValid).toBe(false); // no lowercase
    expect((await validate(validator, "Abcdefg!")).isValid).toBe(false); // no number
    expect((await validate(validator, "Abcdefg1")).isValid).toBe(false); // no special
    expect((await validate(validator, "Ab1!")).isValid).toBe(false); // too short
  });

  it("honors a custom minimum length", async () => {
    const validator = v.string().strongPassword(12);
    expect((await validate(validator, "Abcdef1!")).isValid).toBe(false); // 8 < 12
    expect((await validate(validator, "Abcdefghij1!")).isValid).toBe(true); // 12
  });
});

describe("matches rule (cross-field)", () => {
  it("passes when the value equals the referenced field", async () => {
    const validator = v.object({
      password: v.string(),
      confirm: v.string().useRule(matchesRule, { field: "password" }),
    });

    expect((await validate(validator, { password: "secret", confirm: "secret" })).isValid).toBe(
      true,
    );
    expect((await validate(validator, { password: "secret", confirm: "other" })).isValid).toBe(
      false,
    );
  });
});
