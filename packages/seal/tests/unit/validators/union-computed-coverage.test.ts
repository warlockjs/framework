import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { ComputedValidator } from "../../../src/validators/computed-validator";
import { ManagedValidator } from "../../../src/validators/managed-validator";

/**
 * Coverage for UnionValidator (nullable, default, toJsonSchema, the
 * collect-all-errors path) and ComputedValidator/ManagedValidator edge paths
 * (callback throwing, clone, matchesType, toJsonSchema throwing).
 *
 * Verified against union-validator.ts, union.ts and computed-validator.ts.
 */

describe("UnionValidator - extended coverage", () => {
  it("passes the value through unchanged on a match", async () => {
    const validator = v.union([v.string(), v.number()]);
    const result = await validate(validator, "hello");
    expect(result.isValid).toBe(true);
    expect(result.data).toBe("hello");
  });

  it("respects inner constraints across distinct types", async () => {
    const validator = v.union([v.string().email(), v.number().min(10)]);
    expect((await validate(validator, "a@b.com")).isValid).toBe(true);
    expect((await validate(validator, 15)).isValid).toBe(true);
    expect((await validate(validator, "not-email")).isValid).toBe(false);
    expect((await validate(validator, 5)).isValid).toBe(false);
  });

  it("with firstErrorOnly:true the union stops at the first type-matching branch", async () => {
    // Both branches are strings, so "abcd" matches the FIRST (.email()) branch,
    // which fails — and firstErrorOnly breaks before the .min(3) branch is tried.
    const validator = v.union([v.string().email(), v.string().min(3)]);
    expect((await validate(validator, "abcd")).isValid).toBe(false);
  });

  it("with firstErrorOnly:false a later same-type branch can rescue the value", async () => {
    // firstErrorOnly:false lets the union try every type-matching branch, so the
    // .min(3) branch validates "abcd" after .email() fails.
    const validator = v.union([v.string().email(), v.string().min(3)]);
    expect((await validate(validator, "abcd", { firstErrorOnly: false })).isValid).toBe(true);
  });

  it("collects all branch errors when firstErrorOnly is false", async () => {
    const validator = v.union([v.string().min(10), v.string().email()]);
    const result = await validate(validator, "no", { firstErrorOnly: false });
    expect(result.isValid).toBe(false);
    // joined message contains feedback from both string branches
    expect(result.errors[0].error).toContain(";");
  });

  it("supports a default value", async () => {
    const validator = v.union([v.string(), v.number()]).default("fallback");
    const result = await validate(validator, undefined);
    expect(result.data).toBe("fallback");
  });

  it("accepts null when nullable", async () => {
    const validator = v.union([v.string(), v.number()]).nullable();
    expect((await validate(validator, null)).isValid).toBe(true);
  });

  it("toJsonSchema maps each branch into oneOf", () => {
    const schema = v.union([v.string(), v.number()]).toJsonSchema("draft-2020-12");
    expect(schema).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
  });
});

describe("ComputedValidator - edge paths", () => {
  it("surfaces a callback error as a validation error", async () => {
    const validator = new ComputedValidator(() => {
      throw new Error("boom");
    });

    const result = await validate(validator, {});
    expect(result.isValid).toBe(false);
    expect(result.errors[0].type).toBe("computed");
    expect(result.errors[0].error).toBe("boom");
  });

  it("uses a generic message for non-Error throws", async () => {
    const validator = new ComputedValidator(() => {
      // eslint-disable-next-line no-throw-literal
      throw "string failure";
    });

    const result = await validate(validator, {});
    expect(result.isValid).toBe(false);
    expect(result.errors[0].error).toBe("Computed field callback failed");
  });

  it("matchesType is permissive (accepts any input)", () => {
    const validator = new ComputedValidator(() => 1);
    expect(validator.matchesType("anything")).toBe(true);
    expect(validator.matchesType(undefined)).toBe(true);
  });

  it("clone preserves the callback and deep-clones the result validator", async () => {
    const original = new ComputedValidator((data) => data.n * 2, v.number().min(5));
    const cloned = original.clone();

    expect((await validate(cloned, { n: 1 })).isValid).toBe(false); // 2 < 5
    expect((await validate(cloned, { n: 3 })).isValid).toBe(true); // 6 >= 5
  });

  it("toJsonSchema throws — computed fields have no input schema", () => {
    const validator = new ComputedValidator(() => 1);
    expect(() => validator.toJsonSchema()).toThrow(/not supported on ComputedValidator/);
  });

  it("is skipped by ObjectValidator.toJsonSchema (no throw at the object level)", () => {
    const schema = v.object({
      title: v.string().required(),
      slug: v.computed((data: any) => data.title),
    });

    const json = schema.toJsonSchema();
    const props = json.properties as Record<string, unknown>;
    expect("slug" in props).toBe(false);
    expect("title" in props).toBe(true);
  });

  it("computed field derives a value inside an object schema", async () => {
    const schema = v.object({
      first: v.string().required(),
      last: v.string().required(),
      full: v.computed((data: any) => `${data.first} ${data.last}`),
    });

    const result = await validate(schema, { first: "Ada", last: "Lovelace" });
    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ first: "Ada", last: "Lovelace", full: "Ada Lovelace" });
  });
});

describe("ManagedValidator - edge paths", () => {
  it("derives a value from context, ignoring input", async () => {
    const schema = v.object({
      ip: v.managed(() => "127.0.0.1"),
    });

    const result = await validate(schema, {});
    expect(result.data).toEqual({ ip: "127.0.0.1" });
  });

  it("validates the managed result against its validator", async () => {
    const validator = new ManagedValidator(() => 2, v.number().min(5));
    // managed value 2 fails min(5)
    expect((await validate(validator, {})).isValid).toBe(false);
  });
});
