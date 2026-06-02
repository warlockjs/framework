import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { TupleValidator } from "../../../src/validators/tuple-validator";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

describe("TupleValidator", () => {
  it("should validate tuple with strict types and expected length", async () => {
    const validator = new TupleValidator([v.string(), v.number()]);

    expect((await validate(validator, ["text", 123])).isValid).toBe(true);

    // Invalid length
    expect((await validate(validator, ["text"])).isValid).toBe(false);
    expect((await validate(validator, ["text", 123, true])).isValid).toBe(false);

    // Invalid types at position
    expect((await validate(validator, [123, 123])).isValid).toBe(false); // First must be string
  });

  // ─────────────────────────────────────────────────────────────────
  // Optional / nullable / default matrix
  //
  // Regression: prior to fix, an optional tuple absent from the parent
  // payload was coerced to `[]`, which then failed the length check —
  // a single bug producing two confusing symptoms (empty array AND a
  // length error) for an optional field.
  // ─────────────────────────────────────────────────────────────────
  describe("optional / nullable / default — absent input handling", () => {
    it("absent + optional → propagates undefined (no length error)", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional(),
      });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({});
      expect("coord" in (result.data as object)).toBe(false);
    });

    it("explicit undefined + optional → propagates undefined", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional(),
      });
      const result = await validate(schema, { coord: undefined });
      expect(result.isValid).toBe(true);
      expect("coord" in (result.data as object)).toBe(false);
    });

    it("present + correct length + correct types → valid", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional(),
      });
      const result = await validate(schema, { coord: ["x", 42] });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ coord: ["x", 42] });
    });

    it("present + wrong length → length error (still fires on present input)", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional(),
      });
      const result = await validate(schema, { coord: ["x"] });
      expect(result.isValid).toBe(false);
    });

    it("required + present empty array → length error", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).required(),
      });
      const result = await validate(schema, { coord: [] });
      expect(result.isValid).toBe(false);
    });

    it("absent + required → error", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).required(),
      });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(false);
    });

    it("absent + optional + .default([...]) → default applied", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional().default(["origin", 0]),
      });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ coord: ["origin", 0] });
    });

    it("null + .nullable() → propagates null", async () => {
      const schema = v.object({
        coord: v.tuple([v.string(), v.number()]).optional().nullable(),
      });
      const result = await validate(schema, { coord: null });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ coord: null });
    });
  });
});
