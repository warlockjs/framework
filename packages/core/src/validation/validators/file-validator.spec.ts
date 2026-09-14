import type { MultipartFile } from "@fastify/multipart";
import { v } from "@warlock.js/seal";
import { describe, expect, it } from "vitest";
import { UploadedFile } from "../../http";
// Importing the validation init registers the file plugin so `v.file()` exists.
import "../init";

/**
 * Card: a built-in optional-file validator rule (skip absent, structured 4xx
 * on a malformed present file) so apps stop hand-rolling the multipart guard.
 *
 * Exercises `v.file().optional()` end to end through `v.object(...)` +
 * `v.validate(...)` — the real seal path a controller hits via
 * `request.validated()`. A minimal MultipartFile stub backs a genuine
 * UploadedFile so the `instanceof UploadedFile` guards pass (same pattern as
 * `file-rules.test.ts`).
 */
function uploadedFile(filename: string, mimetype: string): UploadedFile {
  return new UploadedFile({ filename, mimetype } as unknown as MultipartFile);
}

describe("v.file().optional() — optional file field", () => {
  it("(i) key absent → valid", async () => {
    const schema = v.object({ avatar: v.file().optional() });

    const result = await v.validate(schema, {});

    expect(result.isValid).toBe(true);
  });

  it("(i-b) value null → valid (measured: null coalesces to absent, same as an omitted key)", async () => {
    const schema = v.object({ avatar: v.file().optional() });

    const result = await v.validate(schema, { avatar: null });

    expect(result.isValid).toBe(true);
  });

  it('(i-b) value "" (multipart\'s empty-file shape) → invalid with a structured error, no throw', async () => {
    const schema = v.object({ avatar: v.file().optional() });

    const result = await v.validate(schema, { avatar: "" });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.input === "avatar")).toBe(true);
  });

  it("(ii) present non-file string → invalid, errors contain a normal message for avatar, no throw", async () => {
    const schema = v.object({ avatar: v.file().optional() });

    const result = await v.validate(schema, { avatar: "abc" });

    expect(result.isValid).toBe(false);
    const avatarError = result.errors.find((error) => error.input === "avatar");
    expect(avatarError).toBeDefined();
    expect(typeof avatarError!.error).toBe("string");
    expect(avatarError!.error.length).toBeGreaterThan(0);
  });

  it("(ii) present non-file plain object → invalid, errors contain a normal message for avatar, no throw", async () => {
    const schema = v.object({ avatar: v.file().optional() });

    const result = await v.validate(schema, { avatar: { not: "a file" } });

    expect(result.isValid).toBe(false);
    const avatarError = result.errors.find((error) => error.input === "avatar");
    expect(avatarError).toBeDefined();
    expect(typeof avatarError!.error).toBe("string");
  });

  it("(iv) present real UploadedFile → valid", async () => {
    const schema = v.object({ avatar: v.file().optional() });
    const png = uploadedFile("photo.png", "image/png");

    const result = await v.validate(schema, { avatar: png });

    expect(result.isValid).toBe(true);
  });

  it("(iv) .optional().image() with a non-image UploadedFile present → structured error, no throw", async () => {
    const schema = v.object({ avatar: v.file().optional().image() });
    const pdf = uploadedFile("report.pdf", "application/pdf");

    const result = await v.validate(schema, { avatar: pdf });

    expect(result.isValid).toBe(false);
    const avatarError = result.errors.find((error) => error.input === "avatar");
    expect(avatarError).toBeDefined();
  });

  it("(iv) .optional().image() with an absent key still passes (optional short-circuits image() too)", async () => {
    const schema = v.object({ avatar: v.file().optional().image() });

    const result = await v.validate(schema, {});

    expect(result.isValid).toBe(true);
  });
});

describe("v.file() required (no .optional()) — required file field", () => {
  it("(iii) key absent → invalid with an avatar error", async () => {
    const schema = v.object({ avatar: v.file() });

    const result = await v.validate(schema, {});

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.input === "avatar")).toBe(true);
  });

  it("present real UploadedFile → valid", async () => {
    const schema = v.object({ avatar: v.file() });
    const png = uploadedFile("photo.png", "image/png");

    const result = await v.validate(schema, { avatar: png });

    expect(result.isValid).toBe(true);
  });
});
