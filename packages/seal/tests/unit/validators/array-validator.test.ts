import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

describe("ArrayValidator", () => {
  it("should validate array type", async () => {
    // ArrayValidator requires an inner validator.
    // Using v.array(v.any()) to validate generic array.
    const validator = v.array(v.any());
    const result = await validate(validator, [1, 2, 3]);
    expect(result.isValid).toBe(true);
  });

  it("should fail for non-array type", async () => {
    const validator = v.array(v.any());
    const result = await validate(validator, "test");
    expect(result.isValid).toBe(false);
  });

  it("should validate items type", async () => {
    // v.array(v.number()) implies all items must be numbers
    const validator = v.array(v.number());

    const valid = await validate(validator, [1, 2, 3]);
    expect(valid.isValid).toBe(true);

    const invalid = await validate(validator, [1, "2", 3]);
    expect(invalid.isValid).toBe(false);
  });

  it("should validate array length", async () => {
    const validator = v.array(v.any()).minLength(2).maxLength(4);

    expect((await validate(validator, [1])).isValid).toBe(false);
    expect((await validate(validator, [1, 2])).isValid).toBe(true);
    expect((await validate(validator, [1, 2, 3, 4])).isValid).toBe(true);
    expect((await validate(validator, [1, 2, 3, 4, 5])).isValid).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Optional / nullable / default matrix
  //
  // Regression: prior to fix, an optional array absent from the parent
  // payload returned `data: []` and the parent ObjectValidator wrote an
  // empty array into the validated output instead of omitting the field.
  // ─────────────────────────────────────────────────────────────────
  describe("optional / nullable / default — absent input handling", () => {
    it("absent + optional → propagates undefined (parent omits the key)", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional() });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({});
      expect("tags" in (result.data as object)).toBe(false);
    });

    it("explicit undefined + optional → propagates undefined", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional() });
      const result = await validate(schema, { tags: undefined });
      expect(result.isValid).toBe(true);
      expect("tags" in (result.data as object)).toBe(false);
    });

    it("present empty array + optional → preserved as []", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional() });
      const result = await validate(schema, { tags: [] });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: [] });
    });

    it("present non-empty array + optional → preserved", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional() });
      const result = await validate(schema, { tags: ["a", "b"] });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: ["a", "b"] });
    });

    it("absent + optional + .default([...]) → default applied", async () => {
      const schema = v.object({
        tags: v.array(v.string()).optional().default(["pending"]),
      });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: ["pending"] });
    });

    it("present + .default([...]) → caller value wins", async () => {
      const schema = v.object({
        tags: v.array(v.string()).optional().default(["pending"]),
      });
      const result = await validate(schema, { tags: ["custom"] });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: ["custom"] });
    });

    it("absent + required → error", async () => {
      const schema = v.object({ tags: v.array(v.string()).required() });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(false);
    });

    it("present empty array + required → valid (empty ≠ missing)", async () => {
      const schema = v.object({ tags: v.array(v.string()).required() });
      const result = await validate(schema, { tags: [] });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: [] });
    });

    it("null + .nullable() → propagates null", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional().nullable() });
      const result = await validate(schema, { tags: null });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ tags: null });
    });

    it("null + not nullable + required → error", async () => {
      const schema = v.object({ tags: v.array(v.string()).required() });
      const result = await validate(schema, { tags: null });
      expect(result.isValid).toBe(false);
    });

    it("present with invalid item type → error from inner validator", async () => {
      const schema = v.object({ tags: v.array(v.string()).optional() });
      const result = await validate(schema, { tags: [123] });
      expect(result.isValid).toBe(false);
    });
  });
});
