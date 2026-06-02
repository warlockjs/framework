import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("ScalarValidator - Comprehensive", () => {
  describe("Type Validation", () => {
    it("validates scalar types", async () => {
      const validator = v.scalar();
      expect((await validate(validator, "string")).isValid).toBe(true);
      expect((await validate(validator, 123)).isValid).toBe(true);
      expect((await validate(validator, true)).isValid).toBe(true);
    });

    it("fails for non-scalar types", async () => {
      const validator = v.scalar();
      expect((await validate(validator, {})).isValid).toBe(false);
      expect((await validate(validator, [])).isValid).toBe(false);
    });
  });

  describe("Accepted Rule", () => {
    it("accepted", async () => {
      expect((await validate(v.scalar().accepted(), "yes")).isValid).toBe(true);
      expect((await validate(v.scalar().accepted(), "on")).isValid).toBe(true);
      expect((await validate(v.scalar().accepted(), 1)).isValid).toBe(true);
      expect((await validate(v.scalar().accepted(), true)).isValid).toBe(true);
      expect((await validate(v.scalar().accepted(), "no")).isValid).toBe(false);
    });

    it("acceptedIf", async () => {
      const validator = v.object({
        terms: v.scalar().acceptedIf("subscribe", true).optional(),
        subscribe: v.boolean(),
      });

      expect((await validate(validator, { subscribe: true, terms: "yes" })).isValid).toBe(true);
      expect((await validate(validator, { subscribe: false })).isValid).toBe(true);
      expect((await validate(validator, { subscribe: true, terms: "no" })).isValid).toBe(false);
    });

    it("acceptedUnless", async () => {
      const validator = v.object({
        terms: v.scalar().acceptedUnless("guest", true).optional(),
        guest: v.boolean(),
      });

      expect((await validate(validator, { guest: false, terms: "yes" })).isValid).toBe(true);
      expect((await validate(validator, { guest: true })).isValid).toBe(true);
      expect((await validate(validator, { guest: false, terms: "no" })).isValid).toBe(false);
    });
  });

  describe("Declined Rule", () => {
    it("declined", async () => {
      expect((await validate(v.scalar().declined(), "no")).isValid).toBe(true);
      expect((await validate(v.scalar().declined(), "off")).isValid).toBe(true);
      expect((await validate(v.scalar().declined(), 0)).isValid).toBe(true);
      expect((await validate(v.scalar().declined(), false)).isValid).toBe(true);
      expect((await validate(v.scalar().declined(), "yes")).isValid).toBe(false);
    });

    it("declinedIf", async () => {
      const validator = v.object({
        marketing: v.scalar().declinedIf("optOut", true).optional(),
        optOut: v.boolean(),
      });

      expect((await validate(validator, { optOut: true, marketing: "no" })).isValid).toBe(true);
      expect((await validate(validator, { optOut: false })).isValid).toBe(true);
      expect((await validate(validator, { optOut: true, marketing: "yes" })).isValid).toBe(false);
    });

    it("declinedUnless", async () => {
      const validator = v.object({
        marketing: v.scalar().declinedUnless("member", true).optional(),
        member: v.boolean(),
      });

      expect((await validate(validator, { member: false, marketing: "no" })).isValid).toBe(true);
      expect((await validate(validator, { member: true })).isValid).toBe(true);
      expect((await validate(validator, { member: false, marketing: "yes" })).isValid).toBe(false);
    });
  });

  describe("Type Checks", () => {
    it("isNumber", async () => {
      expect((await validate(v.scalar().asNumber(), 123)).isValid).toBe(true);
      expect((await validate(v.scalar().asNumber(), "123")).isValid).toBe(true);
    });

    it("isBoolean", async () => {
      expect((await validate(v.scalar(), true)).isValid).toBe(true);
      expect((await validate(v.scalar(), "true")).isValid).toBe(true);
    });

    it("isNull", async () => {
      expect((await validate(v.scalar().nullable(), null)).isValid).toBe(true);
    });
  });

  describe("Equality", () => {
    it("equals", async () => {
      expect((await validate(v.scalar().equal("test"), "test")).isValid).toBe(true);
      expect((await validate(v.scalar().equal(123), 123)).isValid).toBe(true);
      expect((await validate(v.scalar().equal("test"), "other")).isValid).toBe(false);
    });

    it("equalsField", async () => {
      const validator = v.object({
        password: v.string(),
        confirmPassword: v.scalar().sameAs("password"),
      });

      expect(
        (await validate(validator, { password: "test123", confirmPassword: "test123" })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { password: "test123", confirmPassword: "different" })).isValid,
      ).toBe(false);
    });
  });

  describe("Enum", () => {
    it("in", async () => {
      expect((await validate(v.scalar().in(["red", "green", "blue"]), "red")).isValid).toBe(true);
      expect((await validate(v.scalar().in([1, 2, 3]), 2)).isValid).toBe(true);
      expect((await validate(v.scalar().in(["red", "green", "blue"]), "yellow")).isValid).toBe(
        false,
      );
    });

    it("notIn", async () => {
      expect((await validate(v.scalar().notIn(["admin", "root"]), "user")).isValid).toBe(true);
      expect((await validate(v.scalar().notIn(["admin", "root"]), "admin")).isValid).toBe(false);
    });
  });

  describe("Mutators", () => {
    it("toString", async () => {
      const result = await validate(v.scalar().asString(), 123);
      expect(result.data).toBe("123");
    });

    it("default value", async () => {
      const result = await validate(v.scalar().default("default"), undefined);
      expect(result.data).toBe("default");
    });
  });
});
