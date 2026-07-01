import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getFile,
  getFileAsync,
  getJsonFile,
  getJsonFileAsync,
  putFile,
  putFileAsync,
  putJsonFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("read/write edge cases", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("getFileAsync rejects when the file is missing", async () => {
    await expect(getFileAsync(path.join(dir, "nope.txt"))).rejects.toThrow();
  });

  it("getFile (sync) throws when the file is missing", () => {
    expect(() => getFile(path.join(dir, "nope.txt"))).toThrow();
  });

  it("getJsonFileAsync throws on invalid JSON", async () => {
    const target = path.join(dir, "broken.json");
    await putFileAsync(target, "{ not valid json");

    await expect(getJsonFileAsync(target)).rejects.toThrow(SyntaxError);
  });

  it("getJsonFile (sync) throws on invalid JSON", async () => {
    const target = path.join(dir, "broken-sync.json");
    await putFileAsync(target, "{ nope");

    expect(() => getJsonFile(target)).toThrow(SyntaxError);
  });

  it("putFileAsync overwrites an existing file", async () => {
    const target = path.join(dir, "swap.txt");

    await putFileAsync(target, "first");
    await putFileAsync(target, "second");

    expect(await getFileAsync(target)).toBe("second");
  });

  it("putFile (sync) overwrites an existing file", () => {
    const target = path.join(dir, "swap-sync.txt");

    putFile(target, "first");
    putFile(target, "second");

    expect(getFile(target)).toBe("second");
  });

  it("putJsonFileAsync pretty-prints with a 2-space indent", async () => {
    const target = path.join(dir, "pretty.json");
    await putJsonFileAsync(target, { name: "warlock", nested: { ok: true } });

    const raw = await readFile(target, "utf-8");

    expect(raw).toBe('{\n  "name": "warlock",\n  "nested": {\n    "ok": true\n  }\n}');
  });
});
