/**
 * The content type stored with an upload (and served by buckets and CDNs)
 * comes from its bytes for raster images, and markup is stored as a download.
 */
import type { MultipartFile } from "@fastify/multipart";
import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { UploadedFile } from "./uploaded-file";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
const HTML_BYTES = Buffer.from("<!DOCTYPE html><p>hi</p>");

class InspectableUpload extends UploadedFile {
  public storedType(content: Buffer) {
    return this.resolveStoredMimeType(content);
  }
}

function upload(filename: string, mimetype: string, bytes: Buffer) {
  return new InspectableUpload({
    filename,
    mimetype,
    toBuffer: async () => bytes,
  } as unknown as MultipartFile);
}

describe("stored content type", () => {
  afterEach(() => config.set("uploads", undefined));

  it("stores png bytes declared text/html as image/png", () => {
    expect(upload("a.png", "text/html", PNG_BYTES).storedType(PNG_BYTES)).toBe("image/png");
  });

  it("stores svg as application/octet-stream", () => {
    expect(upload("a.svg", "image/svg+xml", SVG_BYTES).storedType(SVG_BYTES)).toBe(
      "application/octet-stream",
    );
  });

  it("stores html declared as text/plain as application/octet-stream", () => {
    expect(upload("a.txt", "text/plain", HTML_BYTES).storedType(HTML_BYTES)).toBe(
      "application/octet-stream",
    );
  });

  it("keeps the declared type for other files", () => {
    const pdf = Buffer.from("%PDF-1.7\n");

    expect(upload("a.pdf", "application/pdf", pdf).storedType(pdf)).toBe("application/pdf");
  });

  it("stores the declared type when uploads.trustClientContentType is true", () => {
    config.set("uploads", { trustClientContentType: true });

    expect(upload("a.svg", "image/svg+xml", SVG_BYTES).storedType(SVG_BYTES)).toBe("image/svg+xml");
  });

  it("reports the sniffed type through detectedMimeType()", async () => {
    expect(await upload("a.html", "image/png", PNG_BYTES).detectedMimeType()).toBe("image/png");
    expect(await upload("a.png", "image/png", HTML_BYTES).detectedMimeType()).toBe("text/html");
    expect(
      await upload("a.bin", "application/octet-stream", Buffer.from("hello")).detectedMimeType(),
    ).toBeUndefined();
  });
});
