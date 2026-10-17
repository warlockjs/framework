import { describe, expect, it } from "vitest";
import { v, validate } from "../../../src";

const owner = v.object({ kind: v.literal("owner"), id: v.literal("__owner__") });
const member = v.object({ kind: v.literal("member"), id: v.string() });
const admin = v.object({ kind: v.literal("admin"), id: v.string(), level: v.int().required() });

describe("union of object members", () => {
  it("accepts a value that matches the second object member", async () => {
    const result = await validate(v.object({ a: v.union([owner, member]) }), {
      a: { kind: "member", id: "x" },
    });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ a: { kind: "member", id: "x" } });
  });

  it("agrees with discriminatedUnion on the same members", async () => {
    const input = { a: { kind: "member", id: "x" } };
    const union = await validate(v.object({ a: v.union([owner, member]) }), input);
    const discriminated = await validate(
      v.object({ a: v.discriminatedUnion("kind", [owner, member]) }),
      input,
    );

    expect(union.isValid).toBe(true);
    expect(union.data).toEqual(discriminated.data);
  });

  it("tries every object member, whatever the member count or position", async () => {
    const schema = v.union([owner, member, admin]);

    expect((await validate(schema, { kind: "owner", id: "__owner__" })).isValid).toBe(true);
    expect((await validate(schema, { kind: "member", id: "m1" })).data).toEqual({
      kind: "member",
      id: "m1",
    });
    expect((await validate(schema, { kind: "admin", id: "a1", level: 2 })).data).toEqual({
      kind: "admin",
      id: "a1",
      level: 2,
    });
  });

  it("tries later members under firstErrorOnly: false too", async () => {
    const result = await validate(
      v.union([owner, member]),
      { kind: "member", id: "x" },
      {
        firstErrorOnly: false,
      },
    );

    expect(result.isValid).toBe(true);
  });

  it("returns the matched member's own output (defaults, stripped keys)", async () => {
    const schema = v.union([
      v.object({ type: v.literal("a"), size: v.int() }),
      v.object({ type: v.literal("b"), tags: v.array(v.string()).default([]) }),
    ]);

    const result = await validate(schema, { type: "b" });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ type: "b", tags: [] });
  });

  it("tries the next member when an earlier member's refinement rejects", async () => {
    const strict = v
      .object({ name: v.string() })
      .refine((value) => (value.name === "root" ? undefined : "Only root"));
    const loose = v.object({ name: v.string(), note: v.string().default("loose") });

    const result = await validate(v.union([strict, loose]), { name: "ada" });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ name: "ada", note: "loose" });
  });

  it("resolves nested unions of objects", async () => {
    const circle = v.object({ shape: v.literal("circle"), radius: v.number() });
    const square = v.object({ shape: v.literal("square"), side: v.number() });
    const label = v.object({ text: v.string().required() });
    const schema = v.object({ item: v.union([v.union([circle, square]), label]) });

    expect((await validate(schema, { item: { shape: "square", side: 2 } })).data).toEqual({
      item: { shape: "square", side: 2 },
    });
    expect((await validate(schema, { item: { text: "hi" } })).data).toEqual({
      item: { text: "hi" },
    });
    expect((await validate(schema, { item: { shape: "hexagon" } })).isValid).toBe(false);
  });

  it("keeps an empty string checked by its members", async () => {
    const schema = v.object({
      a: v.union([v.object({ x: v.string() }), v.literal("")]).present(),
    });

    expect((await validate(schema, { a: "" })).isValid).toBe(true);
    expect((await validate(schema, { a: { x: "y" } })).data).toEqual({ a: { x: "y" } });
  });

  it("validates through Standard Schema", async () => {
    const schema = v.union([owner, member]);

    const passed = await schema["~standard"].validate({ kind: "member", id: "x" });
    expect(passed).toEqual({ value: { kind: "member", id: "x" } });

    const failed = await schema["~standard"].validate({ kind: "member", id: 5 });
    expect("issues" in failed && failed.issues?.[0]?.path).toEqual([{ key: "id" }]);
  });
});

describe("union error reporting when no member matches", () => {
  it("reports the closest member: fewest mismatched literals, then fewest errors", async () => {
    // owner fails on both literals, member only on `id`.
    const result = await validate(v.object({ a: v.union([owner, member]) }), {
      a: { kind: "member", id: 5 },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ type: "union", input: "a.id" });
  });

  it("prefers a member whose literals match over an earlier member with as many errors", async () => {
    // member fails on `kind` (a literal), admin only on its missing `level`.
    const result = await validate(v.union([owner, member, admin]), { kind: "admin", id: "a1" });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ type: "union", input: "level" })]);
  });

  it("reports the branch whose tag matches over an earlier branch", async () => {
    const email = v.object({
      type: v.literal("email"),
      to: v.string().email(),
      subject: v.string(),
    });
    const sms = v.object({ type: v.literal("sms"), to: v.string(), message: v.string() });

    const result = await validate(v.union([email, sms]), { type: "sms", to: "555-1234" });

    expect(result.errors).toEqual([expect.objectContaining({ type: "union", input: "message" })]);
  });

  it("prefers the member that failed deepest when error counts tie", async () => {
    const flat = v.object({ profile: v.string() });
    const nested = v.object({ profile: v.object({ age: v.int() }) });

    const result = await validate(v.union([flat, nested]), { profile: { age: "old" } });

    expect(result.errors).toEqual([
      expect.objectContaining({ type: "union", input: "profile.age" }),
    ]);
  });

  it("falls back to declaration order on a full tie", async () => {
    const first = v.object({ a: v.int() }).allowUnknown();
    const second = v.object({ b: v.int() }).allowUnknown();

    const result = await validate(v.union([first, second]), { a: "x", b: "y" });

    expect(result.errors).toEqual([expect.objectContaining({ input: "a" })]);
  });

  it("reports only the closest member's first error under firstErrorOnly", async () => {
    const wide = v.object({
      kind: v.literal("wide"),
      x: v.int().required(),
      y: v.int().required(),
    });

    const result = await validate(v.union([owner, wide]), { kind: "wide" });

    expect(result.errors).toEqual([expect.objectContaining({ type: "union", input: "x" })]);
  });

  it("reports every error of the closest member when firstErrorOnly is false", async () => {
    const wide = v.object({
      kind: v.literal("wide"),
      x: v.int().required(),
      y: v.int().required(),
    });

    const result = await validate(
      v.object({ a: v.union([owner, wide]) }),
      { a: { kind: "wide" } },
      { firstErrorOnly: false },
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => [error.type, error.input])).toEqual([
      ["union", "a.x"],
      ["union", "a.y"],
    ]);
  });

  it("keeps a custom union message as a single error at the union's path", async () => {
    const schema = v.object({ a: v.union([owner, member], "Unknown actor") });

    const result = await validate(
      schema,
      { a: { kind: "member", id: 5 } },
      { firstErrorOnly: false },
    );

    expect(result.errors).toEqual([{ type: "union", error: "Unknown actor", input: "a" }]);
  });

  it("keeps the default message when no member matches the value's type", async () => {
    const schema = v.object({ a: v.union([owner, member]) });

    // Run a failing member first: its message must not leak into the next call.
    await validate(schema, { a: { kind: "member", id: 5 } });
    const result = await validate(schema, { a: "text" });

    expect(result.errors).toEqual([
      { type: "union", error: "Value must match one of the allowed types", input: "a" },
    ]);
  });

  it("keeps scalar unions reporting at the union's path", async () => {
    const schema = v.object({ contact: v.union([v.string().email(), v.number().min(10)]) });

    const result = await validate(schema, { contact: 5 });

    expect(result.errors).toEqual([expect.objectContaining({ type: "union", input: "contact" })]);
  });
});
