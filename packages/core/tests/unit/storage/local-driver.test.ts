import { mkdtempSync, rmSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "../../../src/storage/drivers/local-driver";

/**
 * Round-trips the LocalDriver against a real OS temp directory. No network, no
 * Docker — just the local filesystem. Each test gets a fresh root so writes can
 * never leak between cases.
 *
 * Source of truth: core/src/storage/drivers/local-driver.ts. Notably, the
 * driver's own `toBuffer` treats a `string` as a FILE PATH (readFile), so these
 * tests feed Buffers for content round-trips.
 */
let root: string;

const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-local-"));
  roots.push(root);
});

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDriver(options: Record<string, any> = {}): LocalDriver {
  return new LocalDriver({ root, ...options });
}

describe("LocalDriver — put / get round-trip", () => {
  it("writes a Buffer and reads it back byte-for-byte", async () => {
    const driver = makeDriver();
    const payload = Buffer.from("hello warlock");

    const data = await driver.put(payload, "docs/note.txt");

    expect(data.path).toBe("docs/note.txt");
    expect(data.driver).toBe("local");
    expect(data.size).toBe(payload.length);

    const readBack = await driver.get("docs/note.txt");

    expect(readBack.equals(payload)).toBe(true);
  });

  it("returns a stable sha-256 hash for the same content", async () => {
    const driver = makeDriver();

    const first = await driver.put(Buffer.from("same-bytes"), "a.bin");
    const second = await driver.put(Buffer.from("same-bytes"), "b.bin");

    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(second.hash);
  });

  it("creates nested directories on demand", async () => {
    const driver = makeDriver();

    await driver.put(Buffer.from("deep"), "a/b/c/d/file.txt");

    expect(await driver.exists("a/b/c/d/file.txt")).toBe(true);
  });

  it("honours an explicit mimeType option", async () => {
    const driver = makeDriver();

    const data = await driver.put(Buffer.from("x"), "weird.unknownext", {
      mimeType: "application/x-custom",
    });

    expect(data.mimeType).toBe("application/x-custom");
  });
});

describe("LocalDriver — putStream", () => {
  it("streams content to disk and reports the size", async () => {
    const driver = makeDriver();
    const stream = Readable.from([Buffer.from("chunk-1-"), Buffer.from("chunk-2")]);

    const data = await driver.putStream(stream, "stream/out.txt");

    expect(data.size).toBe("chunk-1-chunk-2".length);
    expect((await driver.get("stream/out.txt")).toString()).toBe("chunk-1-chunk-2");
  });
});

describe("LocalDriver — exists / delete", () => {
  it("reports existence accurately", async () => {
    const driver = makeDriver();

    expect(await driver.exists("ghost.txt")).toBe(false);

    await driver.put(Buffer.from("here"), "ghost.txt");

    expect(await driver.exists("ghost.txt")).toBe(true);
  });

  it("deletes an existing file and returns true", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("doomed"), "kill.txt");

    expect(await driver.delete("kill.txt")).toBe(true);
    expect(await driver.exists("kill.txt")).toBe(false);
  });

  it("returns false when deleting a missing file", async () => {
    const driver = makeDriver();

    expect(await driver.delete("never-existed.txt")).toBe(false);
  });

  it("deleteMany returns a per-file status list", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("1"), "one.txt");
    await driver.put(Buffer.from("2"), "two.txt");

    const results = await driver.deleteMany(["one.txt", "missing.txt", "two.txt"]);

    expect(results).toEqual([
      { location: "one.txt", deleted: true },
      { location: "missing.txt", deleted: false },
      { location: "two.txt", deleted: true },
    ]);
  });
});

describe("LocalDriver — copy / move", () => {
  it("copies a file, leaving the original in place", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("original"), "src.txt");

    const copy = await driver.copy("src.txt", "dest.txt");

    expect(copy.path).toBe("dest.txt");
    expect(await driver.exists("src.txt")).toBe(true);
    expect((await driver.get("dest.txt")).toString()).toBe("original");
  });

  it("moves a file, removing the source", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("movable"), "from.txt");

    const moved = await driver.move("from.txt", "to.txt");

    expect(moved.path).toBe("to.txt");
    expect(await driver.exists("from.txt")).toBe(false);
    expect((await driver.get("to.txt")).toString()).toBe("movable");
  });

  it("throws when copying a missing source", async () => {
    const driver = makeDriver();

    await expect(driver.copy("nope.txt", "x.txt")).rejects.toThrow(/Source file not found/);
  });
});

describe("LocalDriver — metadata / size / list", () => {
  it("returns metadata for an existing file", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("12345"), "meta.txt");

    const info = await driver.metadata("meta.txt");

    expect(info.name).toBe("meta.txt");
    expect(info.size).toBe(5);
    expect(info.isDirectory).toBe(false);
  });

  it("size() is a shortcut for metadata().size", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("seven!!"), "s.txt");

    expect(await driver.size("s.txt")).toBe(7);
  });

  // list() guards on `directoryExistsAsync(directoryPath)`, so a real directory
  // is listed correctly. (Previously it guarded on `fileExistsAsync`, which
  // returns false for directories and made list() always return [].)
  it("list() returns the entries of a populated directory", async () => {
    const driver = makeDriver();
    await driver.put(Buffer.from("a"), "dir/a.txt");
    await driver.put(Buffer.from("b"), "dir/b.txt");

    const entries = await driver.list("dir");

    expect(entries.map((entry) => entry.name).sort()).toEqual(["a.txt", "b.txt"]);
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      join("dir", "a.txt"),
      join("dir", "b.txt"),
    ]);
  });

  it("returns an empty list for a missing directory", async () => {
    const driver = makeDriver();

    expect(await driver.list("does-not-exist")).toEqual([]);
  });
});

describe("LocalDriver — url", () => {
  it("builds a url with no prefix", () => {
    const driver = makeDriver();

    expect(driver.url("images/x.png")).toBe("/images/x.png");
  });

  it("applies a configured urlPrefix", () => {
    const driver = makeDriver({ urlPrefix: "/uploads" });

    expect(driver.url("images/x.png")).toBe("/uploads/images/x.png");
  });
});

describe("LocalDriver — prefix application", () => {
  it("prepends the configured prefix to the absolute path", async () => {
    const driver = makeDriver({ prefix: "tenant-1" });

    await driver.put(Buffer.from("scoped"), "file.txt");

    // The file lands under <root>/tenant-1/file.txt on disk.
    const onDisk = await readFile(join(root, "tenant-1", "file.txt"));

    expect(onDisk.toString()).toBe("scoped");
  });

  it("does not double-apply an already-prefixed path", () => {
    const driver = makeDriver({ prefix: "p" });

    expect(driver.applyPrefix("p/already.txt")).toBe("p/already.txt");
    expect(driver.applyPrefix("fresh.txt")).toBe("p/fresh.txt");
  });
});

describe("LocalDriver — temporary URL tokens", () => {
  const signatureKey = "test-signature-key-please-change";

  it("throws when no signatureKey is configured", async () => {
    const driver = makeDriver();

    await expect(driver.temporaryUrl("file.txt")).rejects.toThrow(/signatureKey/);
  });

  it("round-trips a valid token back to its path", async () => {
    const driver = makeDriver({ signatureKey });
    await driver.put(Buffer.from("secret"), "private/doc.txt");

    const tempUrl = await driver.temporaryUrl("private/doc.txt", 3600);
    const token = tempUrl.split("/").pop()!;

    const validation = await driver.validateTemporaryToken(token);

    expect(validation.valid).toBe(true);
    expect(validation.path).toBe("private/doc.txt");
  });

  it("rejects an expired token", async () => {
    const driver = makeDriver({ signatureKey });
    await driver.put(Buffer.from("secret"), "private/doc.txt");

    const token = driver.encodeTemporaryToken("private/doc.txt", -10);

    const validation = await driver.validateTemporaryToken(token);

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("expired");
  });

  it("rejects a tampered token", async () => {
    const driver = makeDriver({ signatureKey });
    await driver.put(Buffer.from("secret"), "private/doc.txt");

    const tempUrl = await driver.temporaryUrl("private/doc.txt", 3600);
    const token = tempUrl.split("/").pop()!;
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");

    const validation = await driver.validateTemporaryToken(tampered);

    expect(validation.valid).toBe(false);
    expect(["invalid_signature", "invalid_token", "file_not_found"]).toContain(validation.error);
  });

  it("reports missing_key when validating without a signatureKey", async () => {
    const driver = makeDriver();

    const validation = await driver.validateTemporaryToken("anything");

    expect(validation).toEqual({ valid: false, error: "missing_key" });
  });
});
