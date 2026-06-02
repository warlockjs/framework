import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for NumberValidator surface the base number suite skips: the
 * sibling-scope comparison variants, the field-comparison short-circuit
 * branches (absent field, non-numeric field), string-length rules, the gt/lt
 * aliases, the toFixed mutator, and toJsonSchema.
 *
 * Verified against number-validator.ts and number-rules.ts.
 */

describe("NumberValidator - extended coverage", () => {
  describe("sibling-scope comparisons", () => {
    it("minSibling / maxSibling compare within the parent object", async () => {
      const minV = v.object({
        bounds: v.object({
          floor: v.number(),
          value: v.number().minSibling("floor"),
        }),
      });
      expect((await validate(minV, { bounds: { floor: 10, value: 15 } })).isValid).toBe(true);
      expect((await validate(minV, { bounds: { floor: 10, value: 5 } })).isValid).toBe(false);

      const maxV = v.object({
        bounds: v.object({
          cap: v.number(),
          value: v.number().maxSibling("cap"),
        }),
      });
      expect((await validate(maxV, { bounds: { cap: 100, value: 50 } })).isValid).toBe(true);
      expect((await validate(maxV, { bounds: { cap: 100, value: 150 } })).isValid).toBe(false);
    });

    it("greaterThanSibling / lessThanSibling enforce strict ordering", async () => {
      const gt = v.object({
        g: v.object({
          start: v.number(),
          end: v.number().greaterThanSibling("start"),
        }),
      });
      expect((await validate(gt, { g: { start: 5, end: 10 } })).isValid).toBe(true);
      expect((await validate(gt, { g: { start: 5, end: 5 } })).isValid).toBe(false);

      const lt = v.object({
        g: v.object({
          ceiling: v.number(),
          value: v.number().lessThanSibling("ceiling"),
        }),
      });
      expect((await validate(lt, { g: { ceiling: 10, value: 5 } })).isValid).toBe(true);
      expect((await validate(lt, { g: { ceiling: 10, value: 10 } })).isValid).toBe(false);
    });

    it("betweenSibling resolves both bounds from siblings", async () => {
      const validator = v.object({
        g: v.object({
          lo: v.number(),
          hi: v.number(),
          value: v.number().betweenSibling("lo", "hi"),
        }),
      });
      expect((await validate(validator, { g: { lo: 10, hi: 20, value: 15 } })).isValid).toBe(true);
      expect((await validate(validator, { g: { lo: 10, hi: 20, value: 5 } })).isValid).toBe(false);
    });

    it("gtSibling / ltSibling aliases behave like their long forms", async () => {
      const gt = v.object({
        g: v.object({ start: v.number(), end: v.number().gtSibling("start") }),
      });
      expect((await validate(gt, { g: { start: 1, end: 2 } })).isValid).toBe(true);

      const lt = v.object({
        g: v.object({ cap: v.number(), value: v.number().ltSibling("cap") }),
      });
      expect((await validate(lt, { g: { cap: 10, value: 9 } })).isValid).toBe(true);
    });
  });

  describe("field-comparison short-circuit branches", () => {
    it("min/max/between pass when the referenced field is absent", async () => {
      const minV = v.object({
        floor: v.number().optional(),
        value: v.number().min("floor"),
      });
      expect((await validate(minV, { value: 1 })).isValid).toBe(true);

      const betweenV = v.object({
        lo: v.number().optional(),
        hi: v.number().optional(),
        value: v.number().between("lo", "hi"),
      });
      expect((await validate(betweenV, { value: 1 })).isValid).toBe(true);
    });

    it("greaterThan/lessThan pass when the referenced field is non-numeric", async () => {
      const gt = v.object({
        label: v.string(),
        value: v.number().greaterThan("label"),
      });
      // "label" resolves to a non-numeric string → rule short-circuits to valid
      expect((await validate(gt, { label: "abc", value: 1 })).isValid).toBe(true);
    });
  });

  describe("aliases", () => {
    it("gt / lt mirror greaterThan / lessThan", async () => {
      expect((await validate(v.number().gt(10), 11)).isValid).toBe(true);
      expect((await validate(v.number().gt(10), 10)).isValid).toBe(false);
      expect((await validate(v.number().lt(10), 9)).isValid).toBe(true);
      expect((await validate(v.number().lt(10), 10)).isValid).toBe(false);
    });

    it("modulusOf mirrors modulo", async () => {
      expect((await validate(v.number().modulusOf(4), 8)).isValid).toBe(true);
      expect((await validate(v.number().modulusOf(4), 7)).isValid).toBe(false);
    });
  });

  describe("string-length rules on numbers", () => {
    it("length checks the string representation length", async () => {
      const validator = v.number().length(4);
      expect((await validate(validator, 1234)).isValid).toBe(true);
      expect((await validate(validator, 123)).isValid).toBe(false);
    });

    it("minLength / maxLength bound the digit count", async () => {
      expect((await validate(v.number().minLength(3), 1234)).isValid).toBe(true);
      expect((await validate(v.number().minLength(3), 12)).isValid).toBe(false);
      expect((await validate(v.number().maxLength(3), 12)).isValid).toBe(true);
      expect((await validate(v.number().maxLength(3), 1234)).isValid).toBe(false);
    });
  });

  describe("toFixed mutator", () => {
    it("formats to fixed decimals (returns a string)", async () => {
      const result = await validate(v.number().toFixed(2), 3.14159);
      expect(result.data).toBe("3.14");
    });
  });

  describe("toJsonSchema", () => {
    it("maps min/max to inclusive bounds", () => {
      expect(v.number().min(0).max(100).toJsonSchema()).toEqual({
        type: "number",
        minimum: 0,
        maximum: 100,
      });
    });

    it("greaterThan/lessThan map to exclusive bounds (2020-12)", () => {
      const schema = v.number().greaterThan(0).lessThan(10).toJsonSchema("draft-2020-12");
      expect(schema.exclusiveMinimum).toBe(0);
      expect(schema.exclusiveMaximum).toBe(10);
    });

    it("draft-07 expresses exclusivity via boolean flags", () => {
      const schema = v.number().greaterThan(0).toJsonSchema("draft-07");
      expect(schema.minimum).toBe(0);
      expect(schema.exclusiveMinimum).toBe(true);
    });

    it("multipleOf and enum are surfaced", () => {
      expect(v.number().multipleOf(5).toJsonSchema().multipleOf).toBe(5);
      expect(v.number().in([1, 2, 3]).toJsonSchema().enum).toEqual([1, 2, 3]);
    });

    it("int validator reports integer type", () => {
      expect(v.int().toJsonSchema().type).toBe("integer");
    });

    it("nullable adds the null branch", () => {
      expect(v.number().nullable().toJsonSchema("draft-2020-12").type).toEqual(["number", "null"]);
    });
  });
});
