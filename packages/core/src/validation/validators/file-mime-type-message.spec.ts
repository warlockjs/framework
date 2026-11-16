import type { MultipartFile } from "@fastify/multipart";
import { v } from "@warlock.js/seal";
import { describe, expect, it, vi } from "vitest";
import { UploadedFile } from "../../http";
// Importing the validation init registers the file plugin so `v.file()` exists.
import "../init";

vi.mock("../../http/middleware/inject-request-context", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();

  return {
    ...original,
    t: (key: string) => (key === "admin.uploadUnrecognisedMedia" ? "Unrecognised media file" : key),
  };
});

function textFile() {
  return new UploadedFile({
    filename: "notes.txt",
    mimetype: "text/plain",
    toBuffer: async () => Buffer.from("plain bytes"),
  } as unknown as MultipartFile);
}

async function firstError(schema: ReturnType<typeof v.file>) {
  const result = await v.validate(v.object({ doc: schema }), { doc: textFile() });

  expect(result.isValid).toBe(false);

  return result.errors[0]?.error;
}

describe("v.file().mimeType() message", () => {
  it("fills :types from a single type", async () => {
    expect(await firstError(v.file().mimeType("application/pdf"))).toContain("application/pdf");
  });

  it("fills :types from an array joined with a comma", async () => {
    const error = await firstError(v.file().mimeType(["image/png", "image/jpeg"]));

    expect(error).toContain("image/png, image/jpeg");
    expect(error).not.toContain(":types");
  });

  it("translates a translation key passed as the error message", async () => {
    expect(
      await firstError(v.file().mimeType("application/pdf", "admin.uploadUnrecognisedMedia")),
    ).toBe("Unrecognised media file");
  });

  it("keeps a literal error message", async () => {
    expect(await firstError(v.file().mimeType("application/pdf", "Upload a PDF, please"))).toBe(
      "Upload a PDF, please",
    );
  });
});
