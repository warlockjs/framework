import type { MultipartFile } from "@fastify/multipart";
import { v } from "@warlock.js/seal";
import { beforeAll, describe, expect, it } from "vitest";
import { UploadedFile } from "../../../src/http";
// Importing the validation init registers the file plugin so `v.file()` exists.
import "../../../src/validation/init";

/**
 * Exercises the file validation RULES (fileRule / imageRule / fileExtensionRule
 * / fileTypeRule) through `v.validate(v.file()..., file)` — the real seal path
 * a controller would hit. A minimal MultipartFile stub backs a genuine
 * UploadedFile so the `instanceof UploadedFile` guards pass.
 *
 * Sources: core/src/validation/file/file.ts (rules) and
 * core/src/validation/validators/file-validator.ts (the v.file() builder).
 */
function uploadedFile(filename: string, mimetype: string): UploadedFile {
  return new UploadedFile({ filename, mimetype } as unknown as MultipartFile);
}

let pngFile: UploadedFile;
let pdfFile: UploadedFile;

beforeAll(() => {
  pngFile = uploadedFile("photo.png", "image/png");
  pdfFile = uploadedFile("report.pdf", "application/pdf");
});

describe("v.file() — base file rule", () => {
  it("accepts an UploadedFile", async () => {
    const result = await v.validate(v.file(), pngFile);

    expect(result.isValid).toBe(true);
  });

  it("rejects a non-file value", async () => {
    const result = await v.validate(v.file(), "just-a-string");

    expect(result.isValid).toBe(false);
  });
});

describe("v.file().image() — image rule", () => {
  it("accepts an image upload", async () => {
    const result = await v.validate(v.file().image(), pngFile);

    expect(result.isValid).toBe(true);
  });

  it("rejects a non-image upload", async () => {
    const result = await v.validate(v.file().image(), pdfFile);

    expect(result.isValid).toBe(false);
  });
});

describe("v.file().accept() — extension rule", () => {
  it("accepts a whitelisted extension (string form)", async () => {
    const result = await v.validate(v.file().accept("png"), pngFile);

    expect(result.isValid).toBe(true);
  });

  it("accepts a whitelisted extension (array form)", async () => {
    const result = await v.validate(v.file().accept(["jpg", "png"]), pngFile);

    expect(result.isValid).toBe(true);
  });

  it("rejects an extension outside the whitelist", async () => {
    const result = await v.validate(v.file().accept(["jpg", "gif"]), pngFile);

    expect(result.isValid).toBe(false);
  });
});

describe("v.file().mimeType() / .pdf() — mime type rule", () => {
  it("accepts a matching mime type", async () => {
    const result = await v.validate(v.file().mimeType("application/pdf"), pdfFile);

    expect(result.isValid).toBe(true);
  });

  it("pdf() accepts a pdf and rejects a png", async () => {
    expect((await v.validate(v.file().pdf(), pdfFile)).isValid).toBe(true);
    expect((await v.validate(v.file().pdf(), pngFile)).isValid).toBe(false);
  });

  it("excel() rejects a png (mime not in the allowed set)", async () => {
    const result = await v.validate(v.file().excel(), pngFile);

    expect(result.isValid).toBe(false);
  });
});
