import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for ScalarValidator's declined cross-field variants exposed via the
 * fluent API (declinedIfRequired / declinedIfPresent / declinedWithout), the
 * acceptedUnless field-equals branch, the asNumber/asString coercions, and the
 * scalar toJsonSchema enum collapse.
 *
 * Verified against scalar-validator.ts and declined-rule.ts.
 */

describe("ScalarValidator - declined cross-field variants (fluent)", () => {
  it("declinedIfRequired requires decline when the other field has a value", async () => {
    const validator = v.object({
      email: v.string().optional(),
      marketing: v.scalar().declinedIfRequired("email").optional(),
    });

    // email empty → not enforced
    expect((await validate(validator, {})).isValid).toBe(true);
    // email present, marketing declined → ok
    expect((await validate(validator, { email: "a@b.com", marketing: "no" })).isValid).toBe(true);
    // email present, marketing accepted → fail
    expect((await validate(validator, { email: "a@b.com", marketing: "yes" })).isValid).toBe(false);
  });

  it("declinedIfPresent requires decline when the other field key exists", async () => {
    const validator = v.object({
      optOut: v.string().optional(),
      consent: v.scalar().declinedIfPresent("optOut").optional(),
    });

    expect((await validate(validator, {})).isValid).toBe(true);
    expect((await validate(validator, { optOut: "x", consent: "no" })).isValid).toBe(true);
    expect((await validate(validator, { optOut: "x", consent: "yes" })).isValid).toBe(false);
  });

  it("declinedWithout requires decline when the other field is missing", async () => {
    const validator = v.object({
      premium: v.string().optional(),
      ads: v.scalar().declinedWithout("premium").optional(),
    });

    // premium present → not enforced
    expect((await validate(validator, { premium: "p" })).isValid).toBe(true);
    // premium missing → ads must be declined
    expect((await validate(validator, { ads: "no" })).isValid).toBe(true);
    expect((await validate(validator, { ads: "yes" })).isValid).toBe(false);
  });

  it("acceptedUnless / declinedUnless via the fluent global-scope form", async () => {
    const accepted = v.object({
      guest: v.boolean(),
      terms: v.scalar().acceptedUnless("guest", true).optional(),
    });
    // guest true → not enforced
    expect((await validate(accepted, { guest: true })).isValid).toBe(true);
    // guest false → terms must be accepted
    expect((await validate(accepted, { guest: false, terms: "yes" })).isValid).toBe(true);
    expect((await validate(accepted, { guest: false, terms: "no" })).isValid).toBe(false);

    const declined = v.object({
      member: v.boolean(),
      marketing: v.scalar().declinedUnless("member", true).optional(),
    });
    expect((await validate(declined, { member: true })).isValid).toBe(true);
    expect((await validate(declined, { member: false, marketing: "no" })).isValid).toBe(true);
    expect((await validate(declined, { member: false, marketing: "yes" })).isValid).toBe(false);
  });
});

describe("ScalarValidator - coercion + matchesType + toJsonSchema", () => {
  it("asNumber coerces a numeric string into a number in the output", async () => {
    const result = await validate(v.scalar().asNumber(), "42");
    expect(result.isValid).toBe(true);
    expect(result.data).toBe(42);
  });

  it("asString coerces a number into its string form", async () => {
    const result = await validate(v.scalar().asString(), 42);
    expect(result.data).toBe("42");
  });

  it("matchesType recognizes string/number/boolean only", () => {
    const validator = v.scalar();
    expect(validator.matchesType("x")).toBe(true);
    expect(validator.matchesType(5)).toBe(true);
    expect(validator.matchesType(true)).toBe(true);
    expect(validator.matchesType({})).toBe(false);
    expect(validator.matchesType(null)).toBe(false);
  });

  it("toJsonSchema is a oneOf union by default, enum when constrained", () => {
    expect(v.scalar().toJsonSchema()).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
    });
    expect(v.scalar().in(["a", "b"]).toJsonSchema()).toEqual({ enum: ["a", "b"] });
  });
});
