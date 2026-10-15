import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "./local-driver";

describe("LocalDriver prefix and streaming", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "local-prefix-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("applies the prefix in url()", () => {
    const driver = new LocalDriver({ root, prefix: "t1", urlPrefix: "/uploads" });

    expect(driver.url("logo.png")).toContain("/uploads/t1/logo.png");
  });

  it("returns prefix-qualified paths from write operations", async () => {
    const driver = new LocalDriver({ root, prefix: "t1" });

    expect((await driver.put("one", "one.txt")).path).toBe("t1/one.txt");
    expect((await driver.putIfAbsent("two", "two.txt"))?.path).toBe("t1/two.txt");
    expect(
      (await driver.putStream(Readable.from([Buffer.from("three")]), "three.txt")).path,
    ).toBe("t1/three.txt");
    expect((await driver.copy("one.txt", "copy.txt")).path).toBe("t1/copy.txt");
    expect((await driver.move("copy.txt", "moved.txt")).path).toBe("t1/moved.txt");
  });

  it("does not leak metadata between prefixes", async () => {
    await new LocalDriver({ root, prefix: "a" }).put("A", "logo.png");
    await new LocalDriver({ root, prefix: "b" }).put("BB", "logo.png");
    const a = new LocalDriver({ root, prefix: "a" });
    const b = new LocalDriver({ root, prefix: "b" });

    await a.metadata("logo.png");

    expect((await b.metadata("logo.png")).size).toBe(2);
  });

  it("rejects a location that climbs out of the prefix", async () => {
    const driver = new LocalDriver({ root, prefix: "t1" });

    await expect(driver.put("x", "../t2/secret")).rejects.toThrow();
  });

  it("hashes putStream and copy content without reading it back", async () => {
    const driver = new LocalDriver({ root });
    const expected = crypto.createHash("sha256").update("hello").digest("hex");

    const streamed = await driver.putStream(Readable.from([Buffer.from("hello")]), "s.txt");
    const copied = await driver.copy("s.txt", "c.txt");

    expect(streamed.hash).toBe(expected);
    expect(copied.hash).toBe(expected);
  });
});
