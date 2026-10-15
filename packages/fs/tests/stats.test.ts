import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { lastModified, lastModifiedAsync, putFileAsync, stats } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("stats", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("lastModifiedAsync returns a recent Date for a file just written", async () => {
    const target = path.join(dir, "fresh.txt");
    const before = Date.now();
    await putFileAsync(target, "hi");

    const mtime = await lastModifiedAsync(target);
    expect(mtime).toBeInstanceOf(Date);
    expect(mtime.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("lastModified (sync) mirrors async", async () => {
    const target = path.join(dir, "fresh-sync.txt");
    await putFileAsync(target, "hi");
    expect(lastModified(target)).toBeInstanceOf(Date);
  });

  it("stats exposes raw fs.Stats", async () => {
    const target = path.join(dir, "stat.txt");
    await putFileAsync(target, "hello");

    const result = await stats(target);
    expect(result.isFile()).toBe(true);
    expect(result.size).toBe(5);
  });
});
