import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDriver } from "./local-driver";

describe("LocalDriver.putIfAbsent()", () => {
  let root: string;
  let driver: LocalDriver;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "put-if-absent-"));
    driver = new LocalDriver({ root });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns data on first call and null on the second, leaving content unchanged", async () => {
    const first = await driver.putIfAbsent("one", "dir/a.txt");
    const second = await driver.putIfAbsent("two", "dir/a.txt");

    expect(first?.path).toBe("dir/a.txt");
    expect(first?.size).toBe(3);
    expect(second).toBeNull();
    expect(fs.readFileSync(path.join(root, "dir/a.txt"), "utf8")).toBe("one");
  });

  it("lets exactly one of 10 concurrent callers win", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        driver.putIfAbsent(`caller-${index}`, "race/file.txt"),
      ),
    );

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("leaves no temp files behind", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => driver.putIfAbsent("x", "tmp/file.txt")),
    );

    expect(fs.readdirSync(path.join(root, "tmp"))).toEqual(["file.txt"]);
  });

  it("throws on non-EEXIST errors and still cleans the temp file", async () => {
    await driver.putIfAbsent("seed", "err/seed.txt");

    const error = Object.assign(new Error("denied"), { code: "EACCES" });
    const linkSpy = vi.spyOn(fs.promises, "link").mockRejectedValueOnce(error);

    await expect(driver.putIfAbsent("x", "err/file.txt")).rejects.toThrow("denied");
    expect(linkSpy).toHaveBeenCalled();
    expect(fs.readdirSync(path.join(root, "err"))).toEqual(["seed.txt"]);
  });
});
