import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  fileExistsAsync,
  getFile,
  getFileAsync,
  getJsonFile,
  getJsonFileAsync,
  putFile,
  putFileAsync,
  putJsonFile,
  putJsonFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("read/write", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("putFileAsync creates parent directories", async () => {
    const target = path.join(dir, "nested/deep/output.txt");
    await putFileAsync(target, "hello");
    expect(await fileExistsAsync(target)).toBe(true);
    expect(await getFileAsync(target)).toBe("hello");
  });

  it("putFile (sync) creates parent directories", () => {
    const target = path.join(dir, "sync/nested/output.txt");
    putFile(target, "hello");
    expect(getFile(target)).toBe("hello");
  });

  it("round-trips JSON via putJsonFileAsync / getJsonFileAsync", async () => {
    const target = path.join(dir, "data.json");
    const value = { name: "warlock", count: 7, nested: { ok: true } };

    await putJsonFileAsync(target, value);
    const roundTripped = await getJsonFileAsync<typeof value>(target);

    expect(roundTripped).toEqual(value);
  });

  it("round-trips JSON synchronously", () => {
    const target = path.join(dir, "sync-data.json");
    const value = [1, 2, 3];
    putJsonFile(target, value);
    expect(getJsonFile<number[]>(target)).toEqual(value);
  });

  it("writes UTF-8 (handles non-ASCII)", async () => {
    const target = path.join(dir, "utf.txt");
    await putFileAsync(target, "héllo — 🌍");
    expect(await getFileAsync(target)).toBe("héllo — 🌍");
  });
});
