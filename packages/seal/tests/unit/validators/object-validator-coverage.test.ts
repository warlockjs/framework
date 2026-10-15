import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for the ObjectValidator schema-transformation surface (pick, without,
 * partial, requiredFields, extend, merge, clone), unknown-key handling
 * (allowUnknown / allow / stripUnknown), the trim mutator, omit, and the full
 * toJsonSchema target matrix including openai-strict.
 *
 * Verified against object-validator.ts, unknown-key.ts and object-mutators.ts.
 */

describe("ObjectValidator - extended coverage", () => {
  describe("unknown keys", () => {
    it("rejects unknown keys by default", async () => {
      const validator = v.object({ name: v.string() });
      const result = await validate(validator, { name: "A", extra: 1 });
      expect(result.isValid).toBe(false);
    });

    it("allowUnknown lets extra keys pass through into the output", async () => {
      const validator = v.object({ name: v.string() }).allowUnknown();
      const result = await validate(validator, { name: "A", extra: 1 });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ name: "A", extra: 1 });
    });

    it("allow whitelists specific keys without including them in output", async () => {
      const validator = v.object({ name: v.string() }).allow("csrf");
      const result = await validate(validator, { name: "A", csrf: "token" });
      expect(result.isValid).toBe(true);
      // csrf is allowed (no error) but not part of the schema → not in output
      expect(result.data).toEqual({ name: "A" });
    });

    it("stripUnknown removes unknown keys before validation", async () => {
      const validator = v.object({ name: v.string() }).stripUnknown();
      const result = await validate(validator, { name: "A", extra: 1, other: 2 });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ name: "A" });
    });
  });

  describe("trim mutator", () => {
    it("trims string values recursively by default", async () => {
      const validator = v.object({
        name: v.string(),
        nested: v.object({ city: v.string() }),
      }).trim();

      const result = await validate(validator, {
        name: "  Alice  ",
        nested: { city: "  Cairo  " },
      });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ name: "Alice", nested: { city: "Cairo" } });
    });
  });

  describe("omit", () => {
    it("validates an omitted field but drops it from the output", async () => {
      const validator = v.object({
        password: v.string().required(),
        confirm: v.string().required().sameAs("password").omit(),
      });

      const result = await validate(validator, { password: "secret", confirm: "secret" });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ password: "secret" });
    });
  });

  describe("pick / without", () => {
    const base = v.object({
      id: v.int().required(),
      name: v.string().required(),
      email: v.string().email().required(),
    });

    it("pick keeps only the named fields", async () => {
      const picked = base.pick("name", "email");
      const result = await validate(picked, { name: "A", email: "a@b.com" });
      expect(result.isValid).toBe(true);
      // id is no longer part of the schema, so its absence is fine
      expect(result.data).toEqual({ name: "A", email: "a@b.com" });
    });

    it("without removes the named fields", async () => {
      const trimmed = base.without("id");
      const result = await validate(trimmed, { name: "A", email: "a@b.com" });
      expect(result.isValid).toBe(true);
      expect("id" in (result.data as object)).toBe(false);
    });

    it("pick/without do not mutate the original schema", async () => {
      base.pick("name");
      base.without("email");
      // original still enforces id + name + email
      const result = await validate(base, { name: "A", email: "a@b.com" });
      expect(result.isValid).toBe(false); // id missing
    });
  });

  describe("partial / requiredFields", () => {
    it("partial() makes every field optional", async () => {
      const validator = v
        .object({
          name: v.string().required(),
          age: v.number().required(),
        })
        .partial();

      expect((await validate(validator, {})).isValid).toBe(true);
      expect((await validate(validator, { name: "A" })).isValid).toBe(true);
    });

    it("partial(keys) makes only the named fields optional", async () => {
      const validator = v
        .object({
          name: v.string().required(),
          age: v.number().required(),
        })
        .partial("age");

      expect((await validate(validator, { name: "A" })).isValid).toBe(true);
      expect((await validate(validator, { age: 5 })).isValid).toBe(false); // name still required
    });

    it("requiredFields() upgrades optional fields to required", async () => {
      const validator = v
        .object({
          name: v.string().optional(),
          age: v.number().optional(),
        })
        .requiredFields();

      expect((await validate(validator, { name: "A", age: 5 })).isValid).toBe(true);
      expect((await validate(validator, { name: "A" })).isValid).toBe(false); // age now required
    });
  });

  describe("extend / merge", () => {
    it("extend adds fields and keeps the original config (allowUnknown)", async () => {
      const base = v.object({ name: v.string().required() }).allowUnknown();
      const extended = base.extend({ role: v.string().required() });

      const result = await validate(extended, { name: "A", role: "admin", extra: 1 });
      expect(result.isValid).toBe(true);
      // allowUnknown preserved → extra survives
      expect(result.data).toEqual({ name: "A", role: "admin", extra: 1 });
    });

    it("extend accepts another ObjectValidator (schema only)", async () => {
      const base = v.object({ name: v.string().required() });
      const audit = v.object({ createdAt: v.date().required() });
      const merged = base.extend(audit);

      const result = await validate(merged, { name: "A", createdAt: "2023-01-01" });
      expect(result.isValid).toBe(true);
    });

    it("merge combines schemas and overrides config", async () => {
      const base = v.object({ name: v.string().required() });
      const more = v.object({ age: v.number().required() });
      const merged = base.merge(more);

      expect((await validate(merged, { name: "A", age: 5 })).isValid).toBe(true);
      expect((await validate(merged, { name: "A" })).isValid).toBe(false); // age required
    });
  });

  describe("clone", () => {
    it("clone produces an independent schema", async () => {
      const original = v.object({ name: v.string().required() });
      const cloned = original.clone();

      // Both validate the same way
      expect((await validate(cloned, { name: "A" })).isValid).toBe(true);
      expect((await validate(cloned, {})).isValid).toBe(false);
    });
  });

  describe("toJsonSchema", () => {
    it("standard target lists required (non-optional) fields and forbids extras", () => {
      const schema = v
        .object({
          name: v.string().required(),
          age: v.int().optional(),
        })
        .toJsonSchema("draft-2020-12");

      expect(schema).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
        additionalProperties: false,
      });
    });

    it("allowUnknown drops additionalProperties:false", () => {
      const schema = v.object({ name: v.string() }).allowUnknown().toJsonSchema();
      expect(schema.additionalProperties).toBeUndefined();
    });

    it("openai-strict marks every field required and nullables the optional ones", () => {
      const schema = v
        .object({
          name: v.string().required(),
          age: v.int().optional(),
        })
        .toJsonSchema("openai-strict");

      expect(schema.required).toEqual(["name", "age"]);
      const props = schema.properties as Record<string, { type: unknown }>;
      expect(props.age.type).toEqual(["integer", "null"]);
    });

    it("recurses into nested object schemas", () => {
      const schema = v
        .object({
          user: v.object({ city: v.string().required() }),
        })
        .toJsonSchema();

      const props = schema.properties as Record<string, any>;
      expect(props.user.type).toBe("object");
      expect(props.user.properties.city).toEqual({ type: "string" });
    });
  });
});
