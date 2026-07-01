import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteAsync,
  atomicWriteJsonAsync,
  directoryExistsAsync,
  fileExistsAsync,
  getFileAsync,
  getJsonFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("atomic write", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("writes the full content visible at the final path", async () => {
    const target = path.join(dir, "out.txt");
    await atomicWriteAsync(target, "atomic content");

    expect(await fileExistsAsync(target)).toBe(true);
    expect(await getFileAsync(target)).toBe("atomic content");
  });

  it("creates parent directories if missing", async () => {
    const target = path.join(dir, "nested/deep/output.txt");
    await atomicWriteAsync(target, "deep");

    expect(await directoryExistsAsync(path.dirname(target))).toBe(true);
    expect(await getFileAsync(target)).toBe("deep");
  });

  it("leaves no temp files behind on success", async () => {
    const target = path.join(dir, "clean.txt");
    await atomicWriteAsync(target, "ok");

    const entries = await readdir(dir);
    // Only the final file should remain.
    expect(entries).toEqual(["clean.txt"]);
  });

  it("overwrites an existing file atomically", async () => {
    const target = path.join(dir, "swap.txt");
    await atomicWriteAsync(target, "v1");
    await atomicWriteAsync(target, "v2");
    expect(await getFileAsync(target)).toBe("v2");
  });

  it("atomicWriteJsonAsync round-trips a JSON value", async () => {
    const target = path.join(dir, "data.json");
    const value = { name: "warlock", items: [1, 2, 3] };

    await atomicWriteJsonAsync(target, value);
    const result = await getJsonFileAsync<typeof value>(target);

    expect(result).toEqual(value);
  });
});
