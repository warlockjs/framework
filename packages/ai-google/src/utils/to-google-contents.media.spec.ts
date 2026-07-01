import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toGoogleContents } from "./to-google-contents";

/** Pull the mapped parts off the single user content. */
function partsOf(content: Message["content"]) {
  const { contents } = toGoogleContents([{ role: "user", content }]);
  return contents[0].parts ?? [];
}

describe("toGoogleContents — multimodal parts", () => {
  it("maps an image to inlineData", () => {
    const parts = partsOf([{ type: "image", source: { base64: "QUJD", mediaType: "image/png" } }]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "QUJD" } });
  });

  it("maps a PDF to inlineData with the application/pdf mime type", () => {
    const parts = partsOf([
      { type: "pdf", source: { base64: "JVBER", mediaType: "application/pdf" } },
    ]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "application/pdf", data: "JVBER" } });
  });

  it("maps audio to inlineData with the audio mime type", () => {
    const parts = partsOf([{ type: "audio", source: { base64: "QUJD", mediaType: "audio/mpeg" } }]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "audio/mpeg", data: "QUJD" } });
  });

  it("throws a typed error for a remote-URL PDF, naming the modality", () => {
    expect(() => partsOf([{ type: "pdf", source: { url: "https://x/doc.pdf" } }])).toThrow(
      InvalidRequestError,
    );
    try {
      partsOf([{ type: "pdf", source: { url: "https://x/doc.pdf" } }]);
    } catch (error) {
      expect((error as Error).message).toContain("pdf");
    }
  });
});
