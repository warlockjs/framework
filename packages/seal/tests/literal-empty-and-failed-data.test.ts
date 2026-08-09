import { describe, expect, it } from "vitest";
import { v } from "../src";

/**
 * Regression cover for the two defects reported from kafr-yasef on 2026-08-09
 * (`plans/2026-08-09-seal-empty-literal-and-unknown-keys.md`).
 *
 * 1. `v.literal("")` could never pass. Every validator is required by default,
 *    and the required rule rejects anything `isEmptyValue` calls empty — which
 *    includes `""`. Worse, `literalRule` did not declare `requiresValue`, so it
 *    defaulted to being skipped on empty values: `.optional()` looked like a
 *    workaround but actually turned the literal check off, collapsing `""`,
 *    `null` and "key absent" into one accepted state.
 *
 * 2. A failed validation returned the raw input as `data` for objects, while a
 *    failed discriminated union returned `undefined` — so a caller that forgot
 *    to branch on `isValid` shipped exactly the fields the schema excluded.
 */

describe("v.literal with an empty-string literal", () => {
  it("accepts the empty string it was told to accept", async () => {
    const result = await v.validate(v.object({ alt: v.literal("") }), { alt: "" });

    expect(result.isValid).toBe(true);
  });

  it("does not report a present empty value as missing", async () => {
    const result = await v.validate(v.object({ alt: v.literal("") }), { alt: "" });

    expect(result.errors.map(e => e.type)).not.toContain("required");
  });

  it("still rejects a non-empty value", async () => {
    const result = await v.validate(v.object({ alt: v.literal("") }), { alt: "prose" });

    expect(result.isValid).toBe(false);
  });

  it("still rejects a missing key — `\"\"` is a value, not an absence", async () => {
    const result = await v.validate(v.object({ alt: v.literal("") }), {});

    expect(result.isValid).toBe(false);
  });

  it("still rejects null", async () => {
    const result = await v.validate(v.object({ alt: v.literal("") }), { alt: null });

    expect(result.isValid).toBe(false);
  });

  it("keeps `.optional()` meaning optional, not 'anything empty goes'", async () => {
    const schema = v.object({ alt: v.literal("").optional() });

    // Absent is fine — that is what optional means.
    expect((await v.validate(schema, {})).isValid).toBe(true);
    // But a present value must still match the literal.
    expect((await v.validate(schema, { alt: "" })).isValid).toBe(true);
    expect((await v.validate(schema, { alt: "prose" })).isValid).toBe(false);
  });

  it("leaves non-empty literals working exactly as before", async () => {
    expect((await v.validate(v.object({ f: v.literal(0) }), { f: 0 })).isValid).toBe(true);
    expect((await v.validate(v.object({ f: v.literal(false) }), { f: false })).isValid).toBe(true);
    expect((await v.validate(v.object({ f: v.literal("a") }), { f: "a" })).isValid).toBe(true);
    expect((await v.validate(v.object({ f: v.literal("a") }), { f: "b" })).isValid).toBe(false);
  });

  it("supports the decorative-image shape the report needed", async () => {
    const decorative = v.object({ decorative: v.literal(true), alt: v.literal("") });

    expect((await v.validate(decorative, { decorative: true, alt: "" })).isValid).toBe(true);
    expect((await v.validate(decorative, { decorative: true, alt: "x" })).isValid).toBe(false);
    expect((await v.validate(decorative, { decorative: true })).isValid).toBe(false);
  });
});

describe("a failed validation never returns the rejected input", () => {
  it("returns undefined data when an object fails on unknown keys", async () => {
    const schema = v.object({ id: v.string().required() });

    const result = await v.validate(schema, {
      id: "n1",
      version: 7,
      authorId: "u1",
      status: "draft",
    });

    expect(result.isValid).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("returns undefined data when an object fails on a rule", async () => {
    const schema = v.object({ id: v.string().required() });

    const result = await v.validate(schema, {});

    expect(result.isValid).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("does not leak internal fields to a caller that forgot to check isValid", async () => {
    const publicDto = v.object({ id: v.string().required() });

    const { data } = await v.validate(publicDto, { id: "n1", authorId: "u1", status: "draft" });

    expect(JSON.stringify(data ?? "")).not.toContain("authorId");
    expect(JSON.stringify(data ?? "")).not.toContain("draft");
  });

  it("still returns the validated data on success", async () => {
    const schema = v.object({ id: v.string().required() });

    const result = await v.validate(schema, { id: "n1" });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ id: "n1" });
  });
});
