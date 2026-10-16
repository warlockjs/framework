import { describe, expect, it } from "vitest";
import { validate, v } from "../../../src";

/**
 * Regression cover for WR-007 and WR-008 (Bureau 0.30 findings).
 *
 * WR-008: 5.25 made a blank string count as missing for literal/enum sets,
 * which also hit `v.literal("")`, where `""` is the value the author listed.
 * WR-007: an optional discriminated union rejected an absent field because its
 * own `validate()` demanded a plain object before `.optional()` was consulted.
 */

describe("empty-string literal", () => {
  const required = v.object({ alt: v.literal("") });
  const optional = v.object({ alt: v.literal("").optional() });
  const present = v.object({ alt: v.literal("").present() });
  const nullable = v.object({ alt: v.literal("").nullable() });

  it("required accepts a present empty string and keeps it", async () => {
    expect(await validate(required, { alt: "" })).toMatchObject({
      isValid: true,
      data: { alt: "" },
    });
  });

  it("required rejects a missing key", async () => {
    expect((await validate(required, {})).isValid).toBe(false);
  });

  it("required rejects null", async () => {
    expect((await validate(required, { alt: null })).isValid).toBe(false);
  });

  it("required rejects other values, including whitespace", async () => {
    expect((await validate(required, { alt: "prose" })).isValid).toBe(false);
    expect((await validate(required, { alt: "  " })).isValid).toBe(false);
  });

  it("present accepts a present empty string", async () => {
    expect(await validate(present, { alt: "" })).toMatchObject({
      isValid: true,
      data: { alt: "" },
    });
    expect((await validate(present, {})).isValid).toBe(false);
  });

  it("optional keeps a supplied empty string instead of dropping it", async () => {
    expect(await validate(optional, { alt: "" })).toMatchObject({
      isValid: true,
      data: { alt: "" },
    });
  });

  it("optional treats a missing key as absent", async () => {
    expect(await validate(optional, {})).toMatchObject({ isValid: true, data: {} });
  });

  it("optional still rejects a non-matching value", async () => {
    expect((await validate(optional, { alt: "prose" })).isValid).toBe(false);
  });

  it("nullable keeps the empty string and accepts null", async () => {
    expect(await validate(nullable, { alt: "" })).toMatchObject({
      isValid: true,
      data: { alt: "" },
    });
    expect(await validate(nullable, { alt: null })).toMatchObject({
      isValid: true,
      data: { alt: null },
    });
  });

  it("a multi-value literal that includes the empty string keeps it", async () => {
    const schema = v.object({ mode: v.literal("", "auto", "manual") });

    expect(await validate(schema, { mode: "" })).toMatchObject({
      isValid: true,
      data: { mode: "" },
    });
    expect((await validate(schema, { mode: "auto" })).isValid).toBe(true);
    expect((await validate(schema, {})).isValid).toBe(false);
  });

  it("a literal set without the empty string still reads blank as missing", async () => {
    const schema = v.object({ mode: v.literal("auto", "manual").optional() });

    expect(await validate(schema, { mode: "" })).toMatchObject({ isValid: true, data: {} });
  });

  it("a union of the empty literal and another schema keeps the empty value", async () => {
    const schema = v.object({ alt: v.union([v.literal(""), v.string().min(3)]).present() });

    expect(await validate(schema, { alt: "" })).toMatchObject({ isValid: true, data: { alt: "" } });
    expect((await validate(schema, { alt: "prose" })).isValid).toBe(true);
  });

  it("a union without an empty member rejects a present empty string", async () => {
    // Guards the case above: before 5.30 the union rule skipped "" entirely,
    // so any `.present()` union accepted it whatever its members were.
    const schema = v.object({ alt: v.union([v.literal("x"), v.int()]).present() });

    expect((await validate(schema, { alt: "" })).isValid).toBe(false);
  });

  it("an optional union still treats a missing key as absent", async () => {
    const schema = v.object({ alt: v.union([v.literal("x"), v.int()]).optional() });

    expect(await validate(schema, {})).toMatchObject({ isValid: true, data: {} });
  });

  it("an explicit .required() puts back the strict rule and rejects the empty string", async () => {
    const schema = v.object({ alt: v.literal("", "a").required() });

    expect((await validate(schema, { alt: "" })).isValid).toBe(false);
  });
});

describe("an empty default satisfies the required check", () => {
  it("v.string().max(n).default('') fills an absent field with ''", async () => {
    const schema = v.object({ note: v.string().max(10).default("") });

    expect(await validate(schema, {})).toMatchObject({ isValid: true, data: { note: "" } });
  });

  it("a supplied value is still validated", async () => {
    const schema = v.object({ note: v.string().max(3).default("") });

    expect((await validate(schema, { note: "too long" })).isValid).toBe(false);
  });

  it("without a default, a required string still rejects a missing key", async () => {
    const schema = v.object({ note: v.string().max(10) });

    expect((await validate(schema, {})).isValid).toBe(false);
  });

  it("a present empty string on a field whose default is '' is that default", async () => {
    // An HTML form posts `note=""` for an untouched input.
    const schema = v.object({ note: v.string().max(10).default("") });

    expect(await validate(schema, { note: "" })).toMatchObject({
      isValid: true,
      data: { note: "" },
    });
    expect(await validate(schema, { note: null })).toMatchObject({
      isValid: true,
      data: { note: "" },
    });
  });

  it("a present empty string still fails required when the default is not blank", async () => {
    const schema = v.object({ note: v.string().default("n/a") });

    expect((await validate(schema, { note: "" })).isValid).toBe(false);
  });

  it("a null default does not satisfy required on a non-nullable field", async () => {
    const schema = v.object({ s: v.string().default(null) });

    expect((await validate(schema, {})).isValid).toBe(false);
    expect((await validate(schema, { s: null })).isValid).toBe(false);
  });

  it("a null default is a value on a nullable field", async () => {
    const schema = v.object({ s: v.string().nullable().default(null) });

    expect(await validate(schema, {})).toMatchObject({ isValid: true, data: { s: null } });
  });

  it("an empty default of the wrong type fails the type rule", async () => {
    const schema = v.object({ n: v.int().default("") });
    const result = await validate(schema, {});

    expect(result.isValid).toBe(false);
    // `v.int()` extends `v.number()`, whose type rule runs first.
    expect(result.errors.map((error) => error.type)).toContain("number");
  });

  it("an empty default of the right type still skips the value rules", async () => {
    const schema = v.object({ note: v.string().min(3).default("") });

    expect(await validate(schema, {})).toMatchObject({ isValid: true, data: { note: "" } });
  });
});

describe("optional discriminated union", () => {
  const tagged = () =>
    v.discriminatedUnion("type", [
      v.object({ type: v.literal("alpha"), value: v.string() }),
      v.object({ type: v.literal("beta"), count: v.int() }),
    ]);

  const optional = v.object({ entry: tagged().optional() });
  const required = v.object({ entry: tagged() });

  it("accepts an absent field", async () => {
    expect(await validate(optional, {})).toMatchObject({ isValid: true, data: {} });
  });

  it("accepts an explicit undefined", async () => {
    expect((await validate(optional, { entry: undefined })).isValid).toBe(true);
  });

  it("validates a supplied valid branch", async () => {
    const result = await validate(optional, { entry: { type: "alpha", value: "owned-fixture" } });

    expect(result).toMatchObject({
      isValid: true,
      data: { entry: { type: "alpha", value: "owned-fixture" } },
    });
  });

  it("rejects a supplied invalid branch", async () => {
    expect((await validate(optional, { entry: { type: "beta", count: "many" } })).isValid).toBe(
      false,
    );
    expect((await validate(optional, { entry: { type: "gamma" } })).isValid).toBe(false);
  });

  it("treats null as absent under .optional(), like every other validator", async () => {
    expect(await validate(optional, { entry: null })).toMatchObject({ isValid: true, data: {} });
  });

  it("rejects null on a required union and keeps it on a nullable one", async () => {
    const result = await validate(required, { entry: null });

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.type)).toContain("required");

    const nullable = v.object({ entry: tagged().nullable() });
    expect(await validate(nullable, { entry: null })).toMatchObject({
      isValid: true,
      data: { entry: null },
    });
  });

  it("a required union reports a missing field as required", async () => {
    const result = await validate(required, {});

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.type)).toContain("required");
  });

  it("an absent field with a default validates the default through its branch", async () => {
    const schema = v.object({ entry: tagged().default({ type: "beta", count: 1 }) });

    expect(await validate(schema, {})).toMatchObject({
      isValid: true,
      data: { entry: { type: "beta", count: 1 } },
    });
  });

  it("a null value is replaced by the default, as on v.object()", async () => {
    const schema = v.object({ entry: tagged().default({ type: "beta", count: 1 }) });

    expect(await validate(schema, { entry: null })).toMatchObject({
      isValid: true,
      data: { entry: { type: "beta", count: 1 } },
    });
  });
});
