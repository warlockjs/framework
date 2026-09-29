import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { ObjectValidator } from "../../../src/validators/object-validator";

describe("ObjectValidator", () => {
  it("should validate object type", async () => {
    const validator = new ObjectValidator({}).allowUnknown();
    const result = await validate(validator, { a: 1 });
    expect(result.isValid).toBe(true);
  });

  it("should fail for non-object type", async () => {
    const validator = new ObjectValidator({});
    const result = await validate(validator, "test");
    expect(result.isValid).toBe(false);
  });

  it("should validate nested shape", async () => {
    const validator = new ObjectValidator({
      name: v.string().required(),
      age: v.number().min(18),
    });

    const valid = await validate(validator, { name: "Alice", age: 20 });
    expect(valid.isValid).toBe(true);

    const invalid = await validate(validator, { name: "Bob", age: 10 });
    expect(invalid.isValid).toBe(false);

    const missing = await validate(validator, { age: 20 });
    expect(missing.isValid).toBe(false); // name required
  });

  // Test nested object
  it("should validate deep nested object", async () => {
    const validator = new ObjectValidator({
      user: v.object({
        address: v.object({
          city: v.string().required(),
        }),
      }),
    });

    const valid = await validate(validator, { user: { address: { city: "Cairo" } } });
    expect(valid.isValid).toBe(true);

    const invalid = await validate(validator, { user: { address: {} } });
    expect(invalid.isValid).toBe(false);
  });

  it("should accept null on a nullable object before recursing into its shape", async () => {
    const validator = new ObjectValidator({
      body: v
        .object({
          en: v.string().required(),
          ar: v.string().required(),
        })
        .nullable()
        .optional(),
    });

    const withNull = await validate(validator, { body: null });
    expect(withNull.isValid).toBe(true);
    expect(withNull.data.body).toBe(null);

    const withUndefined = await validate(validator, {});
    expect(withUndefined.isValid).toBe(true);

    const withMissingKey = await validate(validator, { body: { en: "hello" } });
    expect(withMissingKey.isValid).toBe(false); // ar required

    const topLevel = new ObjectValidator({
      en: v.string().required(),
      ar: v.string().required(),
    }).nullable();

    const topLevelNull = await validate(topLevel, null);
    expect(topLevelNull.isValid).toBe(true);
    expect(topLevelNull.data).toBe(null);
  });

  // FORMAI (5.24): `.nullish()` objects validated their children on null.
  // `.nullish()` is `.optional().nullable()`, so the 5.25 nullable fix covers it.
  it("accepts null and a missing value on a nullish object without validating its children", async () => {
    const schema = v.object({
      profile: v.object({ name: v.string().required() }).nullish(),
      deep: v.object({ inner: v.object({ id: v.string().required() }).nullish() }),
    });

    const withNull = await validate(schema, { profile: null, deep: { inner: null } });
    expect(withNull.isValid).toBe(true);
    expect(withNull.errors).toEqual([]);

    const missing = await validate(schema, { deep: {} });
    expect(missing.isValid).toBe(true);
    expect(missing.errors).toEqual([]);

    const topLevel = v.object({ name: v.string().required() }).nullish();
    expect((await validate(topLevel, null)).isValid).toBe(true);
  });
});
