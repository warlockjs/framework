import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for ArrayValidator features the base array suite skips: the array
 * mutators (flip/reverse/onlyUnique/sort), the unique and sorted rules, the
 * exact-length / between-length rules, nested-array item validation, and
 * toJsonSchema.
 *
 * Verified against array-validator.ts and array-rules.ts.
 */

describe("ArrayValidator - extended coverage", () => {
  describe("length rules", () => {
    it("length enforces an exact item count", async () => {
      const validator = v.array(v.number()).length(3);
      expect((await validate(validator, [1, 2, 3])).isValid).toBe(true);
      expect((await validate(validator, [1, 2])).isValid).toBe(false);
      expect((await validate(validator, [1, 2, 3, 4])).isValid).toBe(false);
    });

    it("between / lengthBetween are inclusive", async () => {
      const validator = v.array(v.string()).between(2, 4);
      expect((await validate(validator, ["a", "b"])).isValid).toBe(true);
      expect((await validate(validator, ["a", "b", "c", "d"])).isValid).toBe(true);
      expect((await validate(validator, ["a"])).isValid).toBe(false);
      expect((await validate(validator, ["a", "b", "c", "d", "e"])).isValid).toBe(false);

      const alias = v.array(v.string()).lengthBetween(1, 2);
      expect((await validate(alias, ["x"])).isValid).toBe(true);
      expect((await validate(alias, ["x", "y", "z"])).isValid).toBe(false);
    });
  });

  describe("content rules", () => {
    it("unique rejects duplicate primitive items", async () => {
      const validator = v.array(v.number()).unique();
      expect((await validate(validator, [1, 2, 3])).isValid).toBe(true);
      expect((await validate(validator, [1, 2, 2])).isValid).toBe(false);
    });

    it("sorted ascending / descending", async () => {
      const asc = v.array(v.number()).sorted();
      expect((await validate(asc, [1, 2, 3])).isValid).toBe(true);
      expect((await validate(asc, [3, 1, 2])).isValid).toBe(false);

      const desc = v.array(v.number()).sorted("desc");
      expect((await validate(desc, [3, 2, 1])).isValid).toBe(true);
      expect((await validate(desc, [1, 2, 3])).isValid).toBe(false);
    });

    it("sorted treats 0- and 1-length arrays as trivially sorted", async () => {
      const validator = v.array(v.number()).sorted();
      expect((await validate(validator, [])).isValid).toBe(true);
      expect((await validate(validator, [5])).isValid).toBe(true);
    });
  });

  describe("mutators (applied before item validation)", () => {
    it("onlyUnique dedupes before length checks", async () => {
      const result = await validate(v.array(v.number()).onlyUnique(), [1, 1, 2, 3, 3]);
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it("flip / reverse reverse the array", async () => {
      const flipped = await validate(v.array(v.number()).flip(), [1, 2, 3]);
      expect(flipped.data).toEqual([3, 2, 1]);

      const reversed = await validate(v.array(v.number()).reverse(), [1, 2, 3]);
      expect(reversed.data).toEqual([3, 2, 1]);
    });

    it("sort orders ascending / descending", async () => {
      const asc = await validate(v.array(v.number()).sort(), [3, 1, 2]);
      expect(asc.data).toEqual([1, 2, 3]);

      const desc = await validate(v.array(v.number()).sort("desc"), [3, 1, 2]);
      expect(desc.data).toEqual([3, 2, 1]);
    });

    it("sort by key orders an array of objects", async () => {
      const validator = v.array(v.object({ age: v.number() })).sort("asc", "age");
      const result = await validate(validator, [{ age: 30 }, { age: 10 }, { age: 20 }]);
      expect(result.data).toEqual([{ age: 10 }, { age: 20 }, { age: 30 }]);
    });
  });

  describe("nested arrays + objects", () => {
    it("validates and transforms items inside nested object schemas", async () => {
      const validator = v.array(
        v.object({
          name: v.string().trim(),
          score: v.number().min(0),
        }),
      );

      const result = await validate(validator, [
        { name: "  Alice  ", score: 10 },
        { name: "Bob", score: 5 },
      ]);
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual([
        { name: "Alice", score: 10 },
        { name: "Bob", score: 5 },
      ]);
    });

    it("reports an error when a nested item fails", async () => {
      const validator = v.array(v.object({ score: v.number().min(0) }));
      const result = await validate(validator, [{ score: 10 }, { score: -5 }]);
      expect(result.isValid).toBe(false);
    });

    it("validates arrays of arrays", async () => {
      const validator = v.array(v.array(v.number()));
      expect((await validate(validator, [[1, 2], [3, 4]])).isValid).toBe(true);
      expect((await validate(validator, [[1, 2], ["x"]])).isValid).toBe(false);
    });
  });

  describe("toJsonSchema", () => {
    it("describes items recursively and item-count bounds", () => {
      const schema = v.array(v.string().min(1)).minLength(1).maxLength(5).toJsonSchema();
      expect(schema).toEqual({
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 5,
      });
    });

    it("exact length maps to equal min/max items", () => {
      const schema = v.array(v.number()).length(3).toJsonSchema();
      expect(schema.minItems).toBe(3);
      expect(schema.maxItems).toBe(3);
    });

    it("nullable arrays gain the null branch", () => {
      const schema = v.array(v.number()).nullable().toJsonSchema("draft-2020-12");
      expect(schema.type).toEqual(["array", "null"]);
    });
  });
});
