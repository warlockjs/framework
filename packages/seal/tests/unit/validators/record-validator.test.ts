import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { RecordValidator } from "../../../src/validators/record-validator";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

describe("RecordValidator", () => {
  it("should validate record with consistent value types", async () => {
    const validator = new RecordValidator(v.string());

    expect((await validate(validator, { a: "val1", b: "val2" })).isValid).toBe(true);
    expect((await validate(validator, {})).isValid).toBe(true); // Empty record is valid object

    expect((await validate(validator, { a: 123 })).isValid).toBe(false); // Value must be string
  });

  it("should validate record keys and integrity", async () => {
    // RecordValidator mainly validates object values.
    // Keys are strings.
    const validator = new RecordValidator(v.number().min(10));

    expect((await validate(validator, { x: 15, y: 20 })).isValid).toBe(true);
    expect((await validate(validator, { x: 5 })).isValid).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Optional / nullable / default matrix
  //
  // Regression: prior to fix, an optional record absent from the parent
  // payload returned `data: {}` and the parent ObjectValidator wrote an
  // empty object into the validated output instead of omitting the field.
  // ─────────────────────────────────────────────────────────────────
  describe("optional / nullable / default — absent input handling", () => {
    it("absent + optional → propagates undefined (parent omits the key)", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional() });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({});
      expect("meta" in (result.data as object)).toBe(false);
    });

    it("explicit undefined + optional → propagates undefined", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional() });
      const result = await validate(schema, { meta: undefined });
      expect(result.isValid).toBe(true);
      expect("meta" in (result.data as object)).toBe(false);
    });

    it("present empty record + optional → preserved as {}", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional() });
      const result = await validate(schema, { meta: {} });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: {} });
    });

    it("present non-empty record + optional → preserved", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional() });
      const result = await validate(schema, { meta: { a: "x" } });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: { a: "x" } });
    });

    it("absent + optional + .default({...}) → default applied", async () => {
      const schema = v.object({
        meta: v.record(v.string()).optional().default({ source: "system" }),
      });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: { source: "system" } });
    });

    it("present + .default({...}) → caller value wins over default", async () => {
      const schema = v.object({
        meta: v.record(v.string()).optional().default({ source: "system" }),
      });
      const result = await validate(schema, { meta: { source: "user" } });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: { source: "user" } });
    });

    it("absent + required → error", async () => {
      const schema = v.object({ meta: v.record(v.string()).required() });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(false);
    });

    it("present empty record + required → valid (empty ≠ missing)", async () => {
      const schema = v.object({ meta: v.record(v.string()).required() });
      const result = await validate(schema, { meta: {} });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: {} });
    });

    it("null + .nullable() → propagates null", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional().nullable() });
      const result = await validate(schema, { meta: null });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ meta: null });
    });

    it("null + not nullable + required → error", async () => {
      const schema = v.object({ meta: v.record(v.string()).required() });
      const result = await validate(schema, { meta: null });
      expect(result.isValid).toBe(false);
    });

    it("present + invalid item type → still validates inner items (no early exit)", async () => {
      const schema = v.object({ meta: v.record(v.string()).optional() });
      const result = await validate(schema, { meta: { a: 123 } });
      expect(result.isValid).toBe(false);
    });
  });
});

describe("record key validators", () => {
  it("supports direct validation without a caller-supplied context", async () => {
    const schema = v.record(v.string(), v.number());
    expect((await schema.validate({ a: 1 })).isValid).toBe(true);
    expect((await schema.validate({ a: "x" })).isValid).toBe(false);
    expect((await v.record(v.number()).validate({ a: 1 })).isValid).toBe(true);
  });
  it("validates keys and values and reports the entry path", async () => {
    const schema = v.object({ counts: v.record(v.literal("draft", "published"), v.int()) });
    expect((await validate(schema, { counts: { draft: 2 } })).data).toEqual({
      counts: { draft: 2 },
    });
    const badKey = await validate(schema, { counts: { other: 2 } });
    expect(badKey.isValid).toBe(false);
    expect(badKey.errors[0]?.input).toBe("counts.other");
    expect((await validate(schema, { counts: { draft: "two" } })).isValid).toBe(false);
  });

  it("refuses non-dictionaries instead of skipping keyed validation", async () => {
    const schema = v.record(v.string(), v.int());
    for (const input of [[1], new Map(), new Date()]) {
      expect((await validate(schema, input)).isValid).toBe(false);
    }
  });

  it("clones key rules and emits propertyNames", async () => {
    const schema = v.record(v.literal("draft"), v.int()).clone();
    expect((await validate(schema, { other: 2 })).isValid).toBe(false);
    expect(schema.toJsonSchema().propertyNames).toEqual(v.literal("draft").toJsonSchema());
  });

  it("rejects malformed arguments when defining a schema", () => {
    expect(() => Reflect.apply(v.record, undefined, [v.string(), {}])).toThrow("second argument");
    expect(() => Reflect.apply(v.record, undefined, [v.string(), null])).toThrow("second argument");
    expect(() => Reflect.apply(v.record, undefined, [null])).toThrow("expected a value validator");
    expect(() => Reflect.construct(RecordValidator, [v.string(), {}])).toThrow("second argument");
  });

  it("retains the single-value and custom error message forms", async () => {
    expect((await validate(v.record(v.int()), { count: 2 })).data).toEqual({ count: 2 });
    const result = await validate(v.record(v.int(), "Expected a dictionary"), "bad");
    expect(result.errors[0]?.error).toBe("Expected a dictionary");
  });
});
