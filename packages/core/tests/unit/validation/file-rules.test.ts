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
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n");
const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const HTML_BYTES = Buffer.from("<!doctype html><html><script>alert(1)</script></html>");

/** Leading bytes that make each declared type sniff as itself. */
const SAMPLE_BYTES: Record<string, Buffer> = {
  "image/png": PNG_BYTES,
  "application/pdf": PDF_BYTES,
};

function uploadedFile(filename: string, mimetype: string, bytes?: Buffer): UploadedFile {
  const content = bytes ?? SAMPLE_BYTES[mimetype] ?? Buffer.from("plain bytes");

  return new UploadedFile({
    filename,
    mimetype,
    toBuffer: async () => content,
  } as unknown as MultipartFile);
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

describe("upload checks read the bytes, not the client's claims", () => {
  it("image() refuses an svg declared image/svg+xml", async () => {
    const svg = uploadedFile("logo.svg", "image/svg+xml", SVG_BYTES);

    expect((await v.validate(v.file().image(), svg)).isValid).toBe(false);
  });

  it("image({ svg: true }) accepts an svg", async () => {
    const svg = uploadedFile("logo.svg", "image/svg+xml", SVG_BYTES);

    expect((await v.validate(v.file().image({ svg: true }), svg)).isValid).toBe(true);
  });

  it("image() refuses html bytes declared image/png", async () => {
    const page = uploadedFile("photo.png", "image/png", HTML_BYTES);

    expect((await v.validate(v.file().image(), page)).isValid).toBe(false);
  });

  it("image() accepts png bytes whatever the declared type", async () => {
    const png = uploadedFile("photo", "application/octet-stream", PNG_BYTES);

    expect((await v.validate(v.file().image(), png)).isValid).toBe(true);
  });

  it("pdf() refuses html bytes declared application/pdf", async () => {
    const page = uploadedFile("report.pdf", "application/pdf", HTML_BYTES);

    expect((await v.validate(v.file().pdf(), page)).isValid).toBe(false);
  });

  it("accept() refuses svg bytes behind a png name unless svg is listed", async () => {
    const svg = uploadedFile("photo.png", "image/png", SVG_BYTES);

    expect((await v.validate(v.file().accept(["png"]), svg)).isValid).toBe(false);
    expect((await v.validate(v.file().accept(["png", "svg"]), svg)).isValid).toBe(true);
  });
});
