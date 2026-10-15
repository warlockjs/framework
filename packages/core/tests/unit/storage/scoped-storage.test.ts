import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "../../../src/storage/drivers/local-driver";
import { ScopedStorage } from "../../../src/storage/scoped-storage";
import { StorageFile } from "../../../src/storage/storage-file";
import { StorageError } from "../../../src/storage/utils/storage-error";

/**
 * Exercises ScopedStorage over a real LocalDriver in an OS temp dir. ScopedStorage
 * wraps driver results in StorageFile instances and owns its own input coercion
 * (`toBuffer`) — which, unlike the driver's, stores a plain string AS CONTENT
 * when no file by that name exists. Source: core/src/storage/scoped-storage.ts.
 */
let root: string;

const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-scoped-"));
  roots.push(root);
});

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorage(): ScopedStorage {
  return new ScopedStorage(new LocalDriver({ root }));
}

describe("ScopedStorage — put returns a StorageFile", () => {
  it("wraps a Buffer put in a StorageFile with rich properties", async () => {
    const storage = makeStorage();

    const file = await storage.put(Buffer.from("payload"), "uploads/photo.jpg");

    expect(file).toBeInstanceOf(StorageFile);
    expect(file.name).toBe("photo.jpg");
    expect(file.extension).toBe("jpg");
    expect(file.directory).toBe("uploads");
    expect(file.path).toBe("uploads/photo.jpg");
  });

  it("stores a raw string as content (not as a file path)", async () => {
    const storage = makeStorage();

    await storage.put("just text content", "notes.txt");

    expect((await storage.get("notes.txt")).toString()).toBe("just text content");
  });

  it("collects a Readable stream into the stored file", async () => {
    const storage = makeStorage();
    const stream = Readable.from([Buffer.from("a"), Buffer.from("b"), Buffer.from("c")]);

    await storage.put(stream, "stream.txt");

    expect((await storage.get("stream.txt")).toString()).toBe("abc");
  });
});

describe("ScopedStorage — name / driver access", () => {
  it("exposes the active driver name", () => {
    const storage = makeStorage();

    expect(storage.name).toBe("local");
  });

  it("returns the same StorageFile path via file()", () => {
    const storage = makeStorage();

    const file = storage.file("a/b.txt");

    expect(file).toBeInstanceOf(StorageFile);
    expect(file.path).toBe("a/b.txt");
  });
});

describe("ScopedStorage — putFromBase64", () => {
  it("decodes a data URL and stores the bytes", async () => {
    const storage = makeStorage();
    const original = Buffer.from("binary-ish");
    const dataUrl = `data:application/octet-stream;base64,${original.toString("base64")}`;

    const file = await storage.putFromBase64(dataUrl, "decoded.bin");

    expect((await storage.get(file.path)).equals(original)).toBe(true);
  });

  it("rejects a malformed data URL", async () => {
    const storage = makeStorage();

    await expect(storage.putFromBase64("not-a-data-url", "x.bin")).rejects.toThrow(
      /Invalid base64 data URL/,
    );
  });
});

describe("ScopedStorage — copy / move via StorageFile", () => {
  it("copies and returns a StorageFile at the destination", async () => {
    const storage = makeStorage();
    await storage.put(Buffer.from("c"), "src.txt");

    const copy = await storage.copy("src.txt", "dst.txt");

    expect(copy).toBeInstanceOf(StorageFile);
    expect(copy.path).toBe("dst.txt");
    expect(await storage.exists("src.txt")).toBe(true);
  });

  it("accepts a StorageFile as the copy source", async () => {
    const storage = makeStorage();
    const source = await storage.put(Buffer.from("c"), "src2.txt");

    const copy = await storage.copy(source, "dst2.txt");

    expect((await storage.get(copy.path)).toString()).toBe("c");
  });

  it("deletes via a StorageFile instance", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("bye"), "temp.txt");

    expect(await storage.delete(file)).toBe(true);
    expect(await storage.exists("temp.txt")).toBe(false);
  });
});

describe("ScopedStorage — path helpers", () => {
  it("prepend joins a prefix and trims slashes", () => {
    const storage = makeStorage();

    expect(storage.prepend("uploads", "image.jpg")).toBe("uploads/image.jpg");
    expect(storage.prepend("uploads/", "/image.jpg")).toBe("uploads/image.jpg");
  });

  it("append inserts a suffix before the extension", () => {
    const storage = makeStorage();

    expect(storage.append("image.jpg", "_thumb")).toBe("image_thumb.jpg");
    expect(storage.append("document.pdf", "_v2")).toBe("document_v2.pdf");
  });

  it("append handles a name with no extension", () => {
    const storage = makeStorage();

    expect(storage.append("README", "_old")).toBe("README_old");
  });
});

describe("ScopedStorage — putFromUrl SSRF guard", () => {
  it("blocks a private-IP literal host (guard is on by default)", async () => {
    const storage = makeStorage();

    await expect(
      storage.putFromUrl("http://169.254.169.254/latest/meta-data/", "stolen.txt"),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("blocks a disallowed scheme", async () => {
    const storage = makeStorage();

    await expect(storage.putFromUrl("file:///etc/passwd", "x.txt")).rejects.toBeInstanceOf(
      StorageError,
    );
  });
});
