import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("coercion behavior", () => {
  describe("v.numeric()", () => {
    it("coerces a numeric string to a number in the output data", async () => {
      const result = await validate(v.object({ qty: v.numeric() }), { qty: "42" });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ qty: 42 });
    });

    it("still applies numeric rules after coercion", async () => {
      const schema = v.object({ qty: v.numeric().min(10) });
      expect((await validate(schema, { qty: "5" })).isValid).toBe(false);
      expect((await validate(schema, { qty: "15" })).isValid).toBe(true);
    });

    it("rejects a non-numeric string", async () => {
      const result = await validate(v.object({ qty: v.numeric() }), { qty: "abc" });
      expect(result.isValid).toBe(false);
    });
  });

  describe("v.int() does NOT coerce", () => {
    it("rejects a numeric string (no coercion mutator on int)", async () => {
      const result = await validate(v.object({ n: v.int() }), { n: "5" });
      expect(result.isValid).toBe(false);
    });

    it("accepts a real integer", async () => {
      const result = await validate(v.object({ n: v.int() }), { n: 5 });
      expect(result.data).toEqual({ n: 5 });
    });
  });

  describe("v.int().coerce()", () => {
    it("coerces a numeric string to a number in the output data", async () => {
      const result = await validate(v.object({ n: v.int().coerce() }), { n: "5" });
      expect(result.isValid).toBe(true);
      expect(result.data.n).toBe(5);
    });

    it("preserves int strictness after coercion (a fractional string still fails)", async () => {
      const result = await validate(v.object({ n: v.int().coerce() }), { n: "5.5" });
      expect(result.isValid).toBe(false);
    });

    it("rejects a non-numeric string (passes through unchanged, fails the type rule)", async () => {
      const result = await validate(v.object({ n: v.int().coerce() }), { n: "abc" });
      expect(result.isValid).toBe(false);
    });

    it("does not affect bare v.int() — the no-coercion guarantee stays intact", async () => {
      const result = await validate(v.object({ n: v.int() }), { n: "5" });
      expect(result.isValid).toBe(false);
    });
  });

  describe("v.number().coerce() / v.float().coerce()", () => {
    it("v.number().coerce() coerces a fractional string to a number", async () => {
      const result = await validate(v.object({ n: v.number().coerce() }), { n: "5.5" });
      expect(result.isValid).toBe(true);
      expect(result.data.n).toBe(5.5);
    });

    it("v.float().coerce() coerces a fractional string to a number", async () => {
      const result = await validate(v.object({ n: v.float().coerce() }), { n: "5.5" });
      expect(result.isValid).toBe(true);
      expect(result.data.n).toBe(5.5);
    });
  });

  describe("v.boolean().coerce()", () => {
    it('coerces the string "true" to true', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "true" });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(true);
    });

    it('coerces the string "1" to true', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "1" });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(true);
    });

    it("coerces the number 1 to true", async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: 1 });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(true);
    });

    it('coerces the string "false" to false', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "false" });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(false);
    });

    it('coerces the string "0" to false', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "0" });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(false);
    });

    it("coerces the number 0 to false", async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: 0 });
      expect(result.isValid).toBe(true);
      expect(result.data.flag).toBe(false);
    });

    it('rejects "yes" (not one of the exact coercible forms)', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "yes" });
      expect(result.isValid).toBe(false);
    });

    it('rejects "on" (not one of the exact coercible forms)', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "on" });
      expect(result.isValid).toBe(false);
    });

    it('rejects "TRUE" (case-sensitive)', async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "TRUE" });
      expect(result.isValid).toBe(false);
    });

    it("rejects an empty string", async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: "" });
      expect(result.isValid).toBe(false);
    });

    it("rejects the number 2", async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: 2 });
      expect(result.isValid).toBe(false);
    });

    it("rejects null", async () => {
      const result = await validate(v.object({ flag: v.boolean().coerce() }), { flag: null });
      expect(result.isValid).toBe(false);
    });

    it('does not affect bare v.boolean() — still rejects the string "true"', async () => {
      const result = await validate(v.object({ flag: v.boolean() }), { flag: "true" });
      expect(result.isValid).toBe(false);
    });

    it("validates a query-string-shaped object with a coerced boolean flag", async () => {
      const schema = v.object({
        active: v.boolean().coerce(),
        page: v.int().coerce(),
      });
      const result = await validate(schema, { active: "true", page: "2" });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ active: true, page: 2 });
    });
  });

  describe("v.scalar() coercion mutators", () => {
    it("asNumber coerces to number", async () => {
      const result = await validate(v.object({ n: v.scalar().asNumber() }), { n: "5" });
      expect(result.data).toEqual({ n: 5 });
    });

    it("asString coerces to string", async () => {
      const result = await validate(v.object({ n: v.scalar().asString() }), { n: 123 });
      expect(result.data).toEqual({ n: "123" });
    });
  });

  describe("v.date() normalization", () => {
    it("normalizes a date string to a Date instance", async () => {
      const result = await validate(v.object({ d: v.date() }), { d: "2024-01-15" });
      expect(result.isValid).toBe(true);
      expect(result.data.d).toBeInstanceOf(Date);
    });

    it("normalizes a numeric timestamp to a Date", async () => {
      const timestamp = Date.UTC(2024, 0, 15);
      const result = await validate(v.object({ d: v.date() }), { d: timestamp });
      expect(result.data.d).toBeInstanceOf(Date);
      expect(result.data.d.getTime()).toBe(timestamp);
    });

    it("toISOString transformer reshapes the output to a string", async () => {
      const result = await validate(v.object({ d: v.date().toISOString() }), { d: "2024-01-15" });
      expect(typeof result.data.d).toBe("string");
      expect(result.data.d).toContain("2024-01-15");
    });
  });

  describe("string mutators reshape before rules", () => {
    it("a pre-validation mutator is visible to subsequent rules", async () => {
      // trim is a transformer (post-validation); addMutator runs pre-validation.
      const schema = v.object({
        code: v
          .string()
          .addMutator((value: string) => value.trim())
          .min(3),
      });

      // "  ab  " trims to "ab" (length 2) → fails min(3)
      expect((await validate(schema, { code: "  ab  " })).isValid).toBe(false);
      // "  abc " trims to "abc" → passes
      const ok = await validate(schema, { code: "  abc " });
      expect(ok.isValid).toBe(true);
      expect(ok.data).toEqual({ code: "abc" });
    });

    it("uppercase mutator transforms the output value", async () => {
      const result = await validate(v.object({ s: v.string().uppercase() }), { s: "hi" });
      expect(result.data).toEqual({ s: "HI" });
    });
  });
});
