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
  putJsonFile,
  putJsonFileAsync,
} from "../src/index";
import { withTempDir } from "./helpers";

describe("read/write — content edge cases", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("round-trips an empty string", async () => {
    const target = path.join(dir, "empty.txt");
    await putFileAsync(target, "");

    expect(await getFileAsync(target)).toBe("");
  });

  it("round-trips a large multi-line payload", async () => {
    const target = path.join(dir, "big.txt");
    const payload = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join(
      "\n",
    );

    await putFileAsync(target, payload);
    expect(await getFileAsync(target)).toBe(payload);
  });

  it("preserves exact bytes including a trailing newline", async () => {
    const target = path.join(dir, "trailing.txt");
    await putFileAsync(target, "ends with newline\n");

    expect(await getFileAsync(target)).toBe("ends with newline\n");
  });

  it("writes into a pre-existing deep directory without re-creating it", async () => {
    const first = path.join(dir, "a/b/one.txt");
    const second = path.join(dir, "a/b/two.txt");

    await putFileAsync(first, "first");
    await putFileAsync(second, "second");

    expect(await getFileAsync(first)).toBe("first");
    expect(await getFileAsync(second)).toBe("second");
  });
});

describe("JSON read/write — shapes + sync formatting", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("putJsonFile (sync) pretty-prints with a 2-space indent", () => {
    const target = path.join(dir, "sync-pretty.json");
    putJsonFile(target, { name: "warlock", nested: { ok: true } });

    expect(getFile(target)).toBe(
      '{\n  "name": "warlock",\n  "nested": {\n    "ok": true\n  }\n}',
    );
  });

  it("round-trips a top-level array", async () => {
    const target = path.join(dir, "array.json");
    const value = [1, "two", { three: 3 }, [4]];

    await putJsonFileAsync(target, value);
    expect(await getJsonFileAsync<typeof value>(target)).toEqual(value);
  });

  it("round-trips a top-level primitive", async () => {
    const target = path.join(dir, "primitive.json");

    await putJsonFileAsync(target, 42);
    expect(await getJsonFileAsync<number>(target)).toBe(42);
  });

  it("round-trips null", async () => {
    const target = path.join(dir, "null.json");

    await putJsonFileAsync(target, null);
    expect(await getJsonFileAsync<null>(target)).toBeNull();
  });

  it("drops undefined object properties (JSON.stringify semantics)", async () => {
    const target = path.join(dir, "drop.json");

    await putJsonFileAsync(target, { kept: 1, gone: undefined });
    expect(await getJsonFileAsync(target)).toEqual({ kept: 1 });
  });

  it("getJsonFile (sync) parses what putJsonFile (sync) wrote", () => {
    const target = path.join(dir, "sync-round.json");
    const value = { items: [1, 2, 3], flag: false };

    putJsonFile(target, value);
    expect(getJsonFile<typeof value>(target)).toEqual(value);
  });

  it("emits no trailing newline (matches raw JSON.stringify output)", async () => {
    const target = path.join(dir, "no-newline.json");
    await putJsonFileAsync(target, { a: 1 });

    const raw = await readFile(target, "utf-8");
    expect(raw.endsWith("\n")).toBe(false);
  });
});
