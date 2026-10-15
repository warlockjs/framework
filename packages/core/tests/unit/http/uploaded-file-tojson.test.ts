import { describe, expect, it } from "vitest";
import { UploadedFile } from "../../../src/http/uploaded-file";

/*
  Canon cd60b894. `toJSON` is the hook `JSON.stringify` calls, and stringify
  does NOT await — so while `UploadedFile.toJSON()` was `async`, every implicit
  serialization of an upload produced `{}`. Not the base64, not the size, not
  even the filename.

  Two call sites in core awaited it and worked. `cascade`'s model serializer
  (`serialization-methods.ts:91`) does not, and `Resource.toJSON()`
  (`resource.ts:191`) is synchronous so it cannot. Those paths were broken.

  Base64-by-default is what forced the method to be async — `buffer()` is
  async — and it also put the entire file, inflated by a third, into any
  response that happened to carry an upload. It is opt-in now: `toBase64()`.
*/

/** The `MultipartFile` shape `UploadedFile` actually reads. */
function fakePart(filename: string, mimetype: string, contents = "hello world") {
  return {
    filename,
    mimetype,
    toBuffer: async () => Buffer.from(contents),
  } as never;
}

describe("UploadedFile.toJSON — the contract JSON.stringify relies on", () => {
  it("survives JSON.stringify instead of collapsing to {}", () => {
    const file = new UploadedFile(fakePart("photo.JPG", "image/jpeg"));

    const serialized = JSON.parse(JSON.stringify({ file }));

    expect(serialized.file).not.toEqual({});
    expect(serialized.file.name).toBe("photo.JPG");
  });

  it("is synchronous — it must not return a promise", () => {
    const file = new UploadedFile(fakePart("photo.jpg", "image/jpeg"));

    expect(file.toJSON()).not.toBeInstanceOf(Promise);
  });

  it("reports the fields that are knowable without reading the file", () => {
    const file = new UploadedFile(fakePart("clip.MP4", "video/mp4"));

    expect(file.toJSON()).toMatchObject({
      name: "clip.MP4",
      mimeType: "video/mp4",
      extension: "mp4",
      isImage: false,
      isVideo: true,
      isAudio: false,
    });
  });
});

describe("UploadedFile.toJSON — size is reported only when it is already known", () => {
  /*
    `size()` reads the whole file. A synchronous `toJSON` cannot do that, and
    guessing would be worse than omitting: a wrong number is believed, an
    absent one is asked about.
  */
  it("omits size before the file has been read", () => {
    const file = new UploadedFile(fakePart("doc.pdf", "application/pdf"));

    expect(file.toJSON().size).toBeUndefined();
  });

  it("includes size once the buffer has been read", async () => {
    const file = new UploadedFile(fakePart("doc.pdf", "application/pdf", "hello world"));

    await file.buffer();

    expect(file.toJSON().size).toBe(11);
  });
});

describe("UploadedFile — base64 is opt-in, never default", () => {
  it("does not put the file contents in toJSON()", () => {
    const file = new UploadedFile(fakePart("doc.pdf", "application/pdf"));

    expect(file.toJSON()).not.toHaveProperty("base64");
  });

  it("still offers base64 explicitly", async () => {
    const file = new UploadedFile(fakePart("doc.pdf", "application/pdf", "hello world"));

    expect(await file.toBase64()).toBe(Buffer.from("hello world").toString("base64"));
  });
});
