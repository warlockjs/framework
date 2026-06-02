import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "../../../src/storage/drivers/local-driver";
import { ScopedStorage } from "../../../src/storage/scoped-storage";
import { StorageFile } from "../../../src/storage/storage-file";

/**
 * Extends storage-file.test.ts into the lazy-load and OOP corners not yet
 * covered: constructing a StorageFile by PATH (no cached data) so `data()` /
 * `size()` / `mimeType()` lazy-fetch from the driver, the absolutePath / URL
 * accessors, the remaining type predicates, rename at the directory root, and
 * the cloud-only guards. Source: core/src/storage/storage-file.ts.
 */
let root: string;

const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-file-extra-"));
  roots.push(root);
});

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDriver(): LocalDriver {
  return new LocalDriver({ root });
}

function makeStorage(): ScopedStorage {
  return new ScopedStorage(makeDriver());
}

describe("StorageFile — lazy data() with no cached data", () => {
  it("fetches size and mimeType from the driver when constructed by path", async () => {
    const storage = makeStorage();
    await storage.put(Buffer.from("12345"), "lazy.txt");

    // file() builds a StorageFile WITHOUT cached data (data: undefined).
    const file = storage.file("lazy.txt");

    expect(file.hash).toBeUndefined(); // hash is only known from a put
    expect(await file.size()).toBe(5);
    expect(await file.mimeType()).toBe("text/plain");
  });

  it("data() constructs StorageFileData with an empty hash and octet fallback mime", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("x"), "no-ext-file");

    // A file with no extension has no guessable mime from the path lookup.
    const file = new StorageFile("no-ext-file", driver);
    const data = await file.data();

    expect(data.path).toBe("no-ext-file");
    expect(data.size).toBe(1);
    expect(data.hash).toBe("");
    expect(data.driver).toBe("local");
  });

  it("lastModified() returns a Date from driver metadata", async () => {
    const storage = makeStorage();
    await storage.put(Buffer.from("x"), "stamp.txt");

    const file = storage.file("stamp.txt");

    expect(await file.lastModified()).toBeInstanceOf(Date);
  });

  it("etag() is undefined for the local driver", async () => {
    const storage = makeStorage();
    await storage.put(Buffer.from("x"), "tag.txt");

    expect(await storage.file("tag.txt").etag()).toBeUndefined();
  });
});

describe("StorageFile — url / absolutePath", () => {
  it("url falls back to the driver url when no cached data", () => {
    const driver = new LocalDriver({ root, urlPrefix: "/uploads" });
    const file = new StorageFile("images/x.png", driver);

    expect(file.url).toBe("/uploads/images/x.png");
  });

  it("absolutePath resolves via the local driver path()", () => {
    const driver = makeDriver();
    const file = new StorageFile("a/b.txt", driver);

    expect(file.absolutePath).toBe(join(root, "a", "b.txt"));
  });
});

describe("StorageFile — remaining type predicates", () => {
  it("detects audio and video by mime prefix", async () => {
    const storage = makeStorage();

    expect(await (await storage.put(Buffer.from("x"), "a.mp3")).isAudio()).toBe(true);
    expect(await (await storage.put(Buffer.from("x"), "v.mp4")).isVideo()).toBe(true);
  });

  it("isImage is false for a plain text file", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "note.txt");

    expect(await file.isImage()).toBe(false);
    expect(await file.isAudio()).toBe(false);
  });
});

describe("StorageFile — rename at the directory root", () => {
  it("renames a root-level file without a leading slash", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("r"), "top.txt");

    // directory is "." for a root file, so rename must not prepend "./".
    await file.rename("renamed.txt");

    expect(file.path).toBe("renamed.txt");
    expect(await storage.exists("renamed.txt")).toBe(true);
  });
});

describe("StorageFile — toJSON after delete", () => {
  it("serializes an empty url once deleted", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "doomed.txt");

    await file.delete();
    const json = file.toJSON();

    expect(json.url).toBe("");
    expect(json.path).toBe("doomed.txt");
  });
});

describe("StorageFile — cloud-only guards on the local driver", () => {
  it("getVisibility throws", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "g.txt");

    await expect(file.getVisibility()).rejects.toThrow(/cloud storage drivers/);
  });

  it("setStorageClass throws", async () => {
    const storage = makeStorage();
    const file = await storage.put(Buffer.from("x"), "s.txt");

    await expect(file.setStorageClass("GLACIER")).rejects.toThrow(/cloud storage drivers/);
  });
});
