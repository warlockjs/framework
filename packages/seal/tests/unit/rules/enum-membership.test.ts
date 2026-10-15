import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for the PrimitiveValidator membership rules (enum/in/oneOf/
 * allowsOnly/forbids/notIn) and the accepted cross-field variants that the
 * existing scalar suite leaves untested (acceptedIfRequired / acceptedIfPresent
 * / acceptedWithout), plus the BooleanValidator-specific accepted/declined
 * surface and strict mustBeTrue/mustBeFalse.
 *
 * Behavior verified against enum.ts, accepted-rule.ts, primitive-validator.ts
 * and boolean-validator.ts.
 */

describe("Membership rules (PrimitiveValidator)", () => {
  describe("enum (from values)", () => {
    it("v.string().enum() accepts the object's values only", async () => {
      const Direction = { North: "north", South: "south" } as const;
      const validator = v.string().enum(Direction);
      expect((await validate(validator, "north")).isValid).toBe(true);
      expect((await validate(validator, "east")).isValid).toBe(false);
    });

    it("v.enum([...]) builds a string validator constrained to the tuple", async () => {
      const validator = v.enum(["draft", "published"]);
      expect((await validate(validator, "draft")).isValid).toBe(true);
      expect((await validate(validator, "archived")).isValid).toBe(false);
    });
  });

  describe("in / oneOf", () => {
    it("in accepts only listed values", async () => {
      const validator = v.string().in(["admin", "user", "guest"]);
      expect((await validate(validator, "admin")).isValid).toBe(true);
      expect((await validate(validator, "root")).isValid).toBe(false);
    });

    it("oneOf is an alias of in", async () => {
      const validator = v.number().oneOf([1, 2, 3]);
      expect((await validate(validator, 2)).isValid).toBe(true);
      expect((await validate(validator, 9)).isValid).toBe(false);
    });
  });

  describe("allowsOnly / forbids / notIn", () => {
    it("allowsOnly behaves like a strict whitelist", async () => {
      const validator = v.string().allowsOnly(["yes", "no"]);
      expect((await validate(validator, "yes")).isValid).toBe(true);
      expect((await validate(validator, "maybe")).isValid).toBe(false);
    });

    it("forbids rejects blacklisted values", async () => {
      const validator = v.string().forbids(["banned", "blocked"]);
      expect((await validate(validator, "ok")).isValid).toBe(true);
      expect((await validate(validator, "banned")).isValid).toBe(false);
    });

    it("notIn is an alias of forbids", async () => {
      const validator = v.number().notIn([0, -1]);
      expect((await validate(validator, 5)).isValid).toBe(true);
      expect((await validate(validator, 0)).isValid).toBe(false);
    });
  });
});

describe("Accepted cross-field variants (ScalarValidator)", () => {
  it("acceptedIfRequired requires acceptance when the other field has a value", async () => {
    const validator = v.object({
      email: v.string().optional(),
      terms: v.scalar().acceptedIfRequired("email").optional(),
    });

    // email empty → terms not enforced
    expect((await validate(validator, {})).isValid).toBe(true);
    // email present, terms accepted
    expect((await validate(validator, { email: "a@b.com", terms: "yes" })).isValid).toBe(true);
    // email present, terms not accepted
    expect((await validate(validator, { email: "a@b.com", terms: "no" })).isValid).toBe(false);
  });

  it("acceptedIfPresent requires acceptance when the other field key exists", async () => {
    const validator = v.object({
      promo: v.string().optional(),
      optIn: v.scalar().acceptedIfPresent("promo").optional(),
    });

    expect((await validate(validator, {})).isValid).toBe(true);
    expect((await validate(validator, { promo: "x", optIn: "yes" })).isValid).toBe(true);
    expect((await validate(validator, { promo: "x", optIn: "no" })).isValid).toBe(false);
  });

  it("acceptedWithout requires acceptance when the other field is missing", async () => {
    const validator = v.object({
      premium: v.string().optional(),
      ads: v.scalar().acceptedWithout("premium").optional(),
    });

    // premium present → ads not enforced
    expect((await validate(validator, { premium: "p" })).isValid).toBe(true);
    // premium missing → ads must be accepted
    expect((await validate(validator, { ads: "yes" })).isValid).toBe(true);
    expect((await validate(validator, { ads: "no" })).isValid).toBe(false);
  });
});

describe("BooleanValidator accepted/declined + strict checks", () => {
  it("accepted only passes for true under the boolean type guard", async () => {
    const validator = v.boolean().accepted();
    expect((await validate(validator, true)).isValid).toBe(true);
    expect((await validate(validator, false)).isValid).toBe(false);
  });

  it("declined only passes for false under the boolean type guard", async () => {
    const validator = v.boolean().declined();
    expect((await validate(validator, false)).isValid).toBe(true);
    expect((await validate(validator, true)).isValid).toBe(false);
  });

  it("mustBeTrue / mustBeFalse enforce strict boolean equality", async () => {
    expect((await validate(v.boolean().mustBeTrue(), true)).isValid).toBe(true);
    expect((await validate(v.boolean().mustBeTrue(), false)).isValid).toBe(false);
    expect((await validate(v.boolean().mustBeFalse(), false)).isValid).toBe(true);
    expect((await validate(v.boolean().mustBeFalse(), true)).isValid).toBe(false);
  });

  it("acceptedIf / declinedIf react to a sibling-by-default global field", async () => {
    const accepted = v.object({
      subscribe: v.boolean(),
      terms: v.boolean().acceptedIf("subscribe", true).optional(),
    });
    expect((await validate(accepted, { subscribe: true, terms: true })).isValid).toBe(true);
    expect((await validate(accepted, { subscribe: true, terms: false })).isValid).toBe(false);
    expect((await validate(accepted, { subscribe: false })).isValid).toBe(true);

    const declined = v.object({
      optOut: v.boolean(),
      marketing: v.boolean().declinedIf("optOut", true).optional(),
    });
    expect((await validate(declined, { optOut: true, marketing: false })).isValid).toBe(true);
    expect((await validate(declined, { optOut: true, marketing: true })).isValid).toBe(false);
  });

  it("toJsonSchema reflects boolean type and nullable", () => {
    expect(v.boolean().toJsonSchema()).toEqual({ type: "boolean" });
    expect(v.boolean().nullable().toJsonSchema("openapi-3.0")).toEqual({
      type: "boolean",
      nullable: true,
    });
  });
});
