import { describe, expect, expectTypeOf, it } from "vitest";
import { validate } from "../../src/factory/validate";
import { v } from "../../src/factory/validators";
import type { Infer } from "../../src/types";

const postSchema = v.object({
  title: v.string().required(),
  body: v.string().optional(),
  views: v.int().default(0),
  authorId: v.int().required().internal(),
});

describe("internal() server-set fields", () => {
  it("keeps the field in the schema and in the inferred type", () => {
    expectTypeOf<Infer.Output<typeof postSchema>>().toEqualTypeOf<{
      title: string;
      body?: string;
      views: number;
      authorId: number;
    }>();
  });

  it("validates an internal field like any other", async () => {
    const result = await validate(postSchema, { title: "a", authorId: 4 });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ title: "a", views: 0, authorId: 4 });
  });

  it("lists the internal keys", () => {
    expect(postSchema.internalKeys()).toEqual(["authorId"]);
    expect(postSchema.schema.authorId.isServerSet()).toBe(true);
    expect(postSchema.schema.title.isServerSet()).toBe(false);
  });

  it("derives a request schema without internal fields, at runtime and in the type", async () => {
    const request = postSchema.withoutInternal();

    expect(Object.keys(request.schema)).toEqual(["title", "body", "views"]);
    expectTypeOf<Infer.Output<typeof request>>().toEqualTypeOf<{
      title: string;
      body?: string;
      views: number;
    }>();

    const result = await validate(request, { title: "a" });

    expect(result.isValid).toBe(true);
  });

  it("does not change the source schema", () => {
    postSchema.withoutInternal();

    expect(Object.keys(postSchema.schema)).toContain("authorId");
  });

  it("survives chaining after internal()", () => {
    const schema = v.object({ ownerId: v.int().internal().optional() });

    expect(schema.internalKeys()).toEqual(["ownerId"]);
  });
});

describe("pick / without / partial keep their types", () => {
  const base = v.object({
    name: v.string().required(),
    age: v.int().required(),
    nickname: v.string().required(),
  });

  it("partial() marks the named keys optional in the type and at runtime", async () => {
    const schema = base.partial("age", "nickname");

    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<{
      name: string;
      age?: number;
      nickname?: string;
    }>();
    expect((await validate(schema, { name: "a" })).isValid).toBe(true);
    expect((await validate(schema, { age: 3 })).isValid).toBe(false);
  });

  it("partial() without keys makes every key optional", async () => {
    const schema = base.partial();

    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<{
      name?: string;
      age?: number;
      nickname?: string;
    }>();
    expect((await validate(schema, {})).isValid).toBe(true);
  });

  it("pick() and without() narrow the inferred type", () => {
    const picked = base.pick("name");
    const without = base.without("name");

    expectTypeOf<Infer.Output<typeof picked>>().toEqualTypeOf<{ name: string }>();
    expectTypeOf<Infer.Output<typeof without>>().toEqualTypeOf<{
      age: number;
      nickname: string;
    }>();
  });
});
