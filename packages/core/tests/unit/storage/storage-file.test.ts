import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "../../../src/storage/drivers/local-driver";
import { ScopedStorage } from "../../../src/storage/scoped-storage";
import { StorageFile } from "../../../src/storage/storage-file";

/**
 * Exercises the StorageFile wrapper against a real LocalDriver. Covers the sync
 * property accessors, lazy content fetchers, type predicates, JSON shape, and
 * the post-delete guard. Source: core/src/storage/storage-file.ts.
 */
let root: string;

const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-file-"));
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

describe("StorageFile — sync properties from cached data", () => {
  it("derives name / extension / directory from the path", async () => {
    const storage = makeStorage();

    const file = await storage.put(Buffer.from("x"), "uploads/sub/report.PDF");

    expect(file.name).toBe("report.PDF");
    expect(file.extension).toBe("pdf"); // lowercased, dot stripped
    expect(file.directory).toBe("uploads/sub");
    expect(file.driver).toBe("local");
  });

  it("exposes the hash captured at put time", async () => {
    const storage = makeStorage();

    const file = await storage.put(Buffer.from("hash-me"), "h.txt");

    expect(file.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("StorageFile — content accessors", () => {
  it("reads contents, text, and base64", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("café"), "c.txt");

    expect((await file.contents()).toString()).toBe("café");
    expect(await file.text()).toBe("café");
    expect(await file.base64()).toBe(Buffer.from("café").toString("base64"));
  });

  it("builds a data URL with the resolved mime type", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("img-bytes"), "pic.png");

    const dataUrl = await file.dataUrl();

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("StorageFile — type predicates", () => {
  it("detects image files", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "a.png");

    expect(await file.isImage()).toBe(true);
    expect(await file.isVideo()).toBe(false);
  });

  it("detects pdf documents", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "doc.pdf");

    expect(await file.isPdf()).toBe(true);
    expect(await file.isDocument()).toBe(true);
  });
});

describe("StorageFile — operations", () => {
  it("copy() returns a new StorageFile and leaves the source", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("c"), "orig.txt");

    const copy = await file.copy("copy.txt");

    expect(copy).toBeInstanceOf(StorageFile);
    expect(copy.path).toBe("copy.txt");
    expect(await file.exists()).toBe(true);
  });

  it("move() mutates this instance's path", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("m"), "before.txt");

    await file.move("after.txt");

    expect(file.path).toBe("after.txt");
  });

  it("rename() moves within the same directory", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("r"), "folder/a.txt");

    await file.rename("b.txt");

    expect(file.path).toBe("folder/b.txt");
  });
});

describe("StorageFile — deleted guard", () => {
  it("flips isDeleted and blocks further reads after delete", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("d"), "gone.txt");

    expect(await file.delete()).toBe(true);
    expect(file.isDeleted).toBe(true);

    await expect(file.contents()).rejects.toThrow(/has been deleted/);
    expect(() => file.url).toThrow(/has been deleted/);
  });

  it("exists() is false after delete without throwing", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("d"), "gone2.txt");

    await file.delete();

    expect(await file.exists()).toBe(false);
  });
});

describe("StorageFile — cloud-only guards", () => {
  it("setVisibility throws on the local driver", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "f.txt");

    await expect(file.setVisibility("public")).rejects.toThrow(/cloud storage drivers/);
  });
});

describe("StorageFile — toJSON", () => {
  it("serializes path / name / extension / driver / cached data", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("json"), "data/file.json");

    const json = file.toJSON();

    expect(json).toMatchObject({
      path: "data/file.json",
      name: "file.json",
      extension: "json",
      driver: "local",
    });
    expect(json.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.size).toBe(4);
  });

  it("toString returns the path", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "p/q.txt");

    expect(file.toString()).toBe("p/q.txt");
  });
});
