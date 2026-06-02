import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("cross-cutting modifiers", () => {
  describe(".optional() — absent vs empty vs null", () => {
    it("omits the key entirely when an optional field is absent (not undefined-valued)", async () => {
      const schema = v.object({
        name: v.string(),
        bio: v.string().optional(),
      });

      const result = await validate(schema, { name: "Hasan" });
      expect(result.isValid).toBe(true);
      expect("bio" in result.data).toBe(false);
    });

    it("preserves a present-but-empty value (empty is not absent)", async () => {
      const schema = v.object({
        tags: v.array(v.string()).optional(),
        meta: v.record(v.string()).optional(),
      });

      const result = await validate(schema, { tags: [], meta: {} });
      expect(result.data).toEqual({ tags: [], meta: {} });
    });

    it("does not synthesize empty containers for absent optional collection fields", async () => {
      const schema = v.object({
        tags: v.array(v.string()).optional(),
        meta: v.record(v.string()).optional(),
        pair: v.tuple([v.string(), v.int()]).optional(),
      });

      const result = await validate(schema, {});
      expect(result.data).toEqual({});
    });

    it("treats null on an optional field as absent (null coalesces to empty)", async () => {
      // `data ?? default` turns null into undefined → empty → the (now absent)
      // required rule is skipped, so an optional field accepts null and omits it.
      const schema = v.object({ bio: v.string().optional() });
      const result = await validate(schema, { bio: null });
      expect(result.isValid).toBe(true);
    });

    it("rejects null on a required field (null coalesces to empty → required fails)", async () => {
      const schema = v.object({ bio: v.string() });
      const result = await validate(schema, { bio: null });
      expect(result.isValid).toBe(false);
    });
  });

  describe(".nullable() / .nullish()", () => {
    it("nullable accepts null and keeps the key", async () => {
      const schema = v.object({ deletedAt: v.date().nullable() });
      const result = await validate(schema, { deletedAt: null });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ deletedAt: null });
    });

    it("a field can be required and nullable at once", async () => {
      const schema = v.object({ deletedAt: v.date().nullable() });

      expect((await validate(schema, { deletedAt: null })).isValid).toBe(true);
      // required-by-default still fires when the key is absent
      expect((await validate(schema, {})).isValid).toBe(false);
    });

    it("nullish = optional + nullable: absent omits, null stays null", async () => {
      const schema = v.object({ a: v.string().nullish() });

      expect((await validate(schema, {})).data).toEqual({});
      expect((await validate(schema, { a: null })).data).toEqual({ a: null });
      expect((await validate(schema, { a: "x" })).data).toEqual({ a: "x" });
    });

    it("notNullable cancels a prior nullable on a required field", async () => {
      const nullableSchema = v.object({ a: v.string().nullable() });
      expect((await validate(nullableSchema, { a: null })).isValid).toBe(true);

      // notNullable removes the null allowance; null then coalesces to empty and
      // the required-by-default rule rejects it.
      const strictSchema = v.object({ a: v.string().nullable().notNullable() });
      expect((await validate(strictSchema, { a: null })).isValid).toBe(false);
    });
  });

  describe(".default()", () => {
    it("fills an absent value and then runs the rule pipeline against it", async () => {
      const schema = v.object({ role: v.string().default("guest") });
      const result = await validate(schema, {});
      expect(result.data).toEqual({ role: "guest" });
    });

    it("a present value wins over the default", async () => {
      const schema = v.object({ role: v.string().default("guest") });
      const result = await validate(schema, { role: "admin" });
      expect(result.data).toEqual({ role: "admin" });
    });

    it("the default flows through rules — an invalid default fails", async () => {
      const schema = v.object({ name: v.string().min(3).default("a") });
      const result = await validate(schema, {});
      expect(result.isValid).toBe(false);
    });

    it("supports a lazy callback default", async () => {
      const schema = v.object({ when: v.date().default(() => new Date()) });
      const result = await validate(schema, {});
      expect(result.data.when).toBeInstanceOf(Date);
    });

    it("works on collection validators", async () => {
      const schema = v.object({ tags: v.array(v.string()).default([]) });
      const result = await validate(schema, {});
      expect(result.data).toEqual({ tags: [] });
    });
  });

  describe(".catch()", () => {
    it("substitutes the fallback when a leaf value is invalid", async () => {
      const result = await validate(v.int().min(0).catch(3), "not-a-number");
      expect(result.isValid).toBe(true);
      expect(result.data).toBe(3);
    });

    it("rescues invalid fields inside an object", async () => {
      const schema = v.object({
        retries: v.int().min(0).catch(3),
        region: v.string().in(["us", "eu"]).catch("us"),
      });

      const result = await validate(schema, { retries: "five", region: "moon" });
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ retries: 3, region: "us" });
    });

    it("passes a valid value through untouched", async () => {
      const result = await validate(v.int().min(0).catch(99), 7);
      expect(result.data).toBe(7);
    });

    it("invokes the callback form with the swallowed errors and original input", async () => {
      let seenInput: unknown;
      let seenErrorCount = 0;

      const validator = v.int().min(0).catch((errors, input) => {
        seenInput = input;
        seenErrorCount = errors.length;
        return -1;
      });

      const result = await validate(validator, "bad");
      expect(result.data).toBe(-1);
      expect(seenInput).toBe("bad");
      expect(seenErrorCount).toBeGreaterThan(0);
    });

    it("is a no-op on a container validator itself (v1 leaf-only scope)", async () => {
      // Catch on the object does NOT rescue a field failure — the object's own
      // iteration path bypasses the leaf catch hook.
      const schema = v.object({ name: v.string().min(3) }).catch({ name: "fallback" });
      const result = await validate(schema, { name: "x" });
      expect(result.isValid).toBe(false);
    });
  });

  describe(".label() — field display name in messages", () => {
    it("substitutes the label for the field key in the :input placeholder", async () => {
      const schema = v.object({ email_address: v.string().label("Email Address") });
      const result = await validate(schema, {});

      expect(result.isValid).toBe(false);
      expect(result.errors[0].error).toContain("Email Address");
      expect(result.errors[0].error).not.toContain("email_address");
    });

    it("per-rule errorMessage overrides the default message", async () => {
      const schema = v.object({ email: v.string().email("Please enter a valid email") });
      const result = await validate(schema, { email: "nope" });

      expect(result.errors[0].error).toBe("Please enter a valid email");
    });
  });

  describe(".omit()", () => {
    it("validates but drops the field from the output", async () => {
      const schema = v.object({
        password: v.string(),
        passwordConfirm: v.string().sameAs("password").omit(),
      });

      const result = await validate(schema, {
        password: "secret",
        passwordConfirm: "secret",
      });

      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ password: "secret" });
    });

    it("still enforces the omitted field's cross-field rule", async () => {
      const schema = v.object({
        password: v.string(),
        passwordConfirm: v.string().sameAs("password").omit(),
      });

      const result = await validate(schema, {
        password: "secret",
        passwordConfirm: "different",
      });

      expect(result.isValid).toBe(false);
    });
  });
});
