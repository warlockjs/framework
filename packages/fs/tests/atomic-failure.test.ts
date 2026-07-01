import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteAsync, atomicWriteJsonAsync } from "../src/index";
import { withTempDir } from "./helpers";

/**
 * Covers the `catch` branch of atomicWriteAsync — when the rename onto the
 * target fails, the temp file must be cleaned up and the original error
 * re-thrown. The exact error code is platform-specific (EPERM on Windows,
 * EISDIR/ENOTEMPTY on POSIX), so we only assert that it throws and that no
 * stray temp file is left behind.
 */
describe("atomic write — failure + cleanup", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("rejects when the target path is an existing directory", async () => {
    const target = path.join(dir, "occupied");
    await mkdir(target);

    await expect(atomicWriteAsync(target, "data")).rejects.toThrow();
  });

  it("removes the temp file when the rename step fails", async () => {
    const target = path.join(dir, "occupied");
    await mkdir(target);

    await expect(atomicWriteAsync(target, "data")).rejects.toThrow();

    const leftoverTemp = (await readdir(dir)).filter((entry) =>
      entry.endsWith(".tmp"),
    );
    expect(leftoverTemp).toEqual([]);
  });

  it("rejects when a parent segment is a file, not a directory", async () => {
    const blocker = path.join(dir, "blocker");
    await writeFile(blocker, "i am a file");

    await expect(
      atomicWriteAsync(path.join(blocker, "child.txt"), "data"),
    ).rejects.toThrow();
  });

  it("does not disturb the existing file when the write fails", async () => {
    // Pre-seed a real file, then point the temp/rename machinery at a
    // directory target so the operation fails; the seeded file is untouched.
    const survivor = path.join(dir, "survivor.txt");
    await writeFile(survivor, "original");

    const target = path.join(dir, "occupied");
    await mkdir(target);
    await expect(atomicWriteAsync(target, "data")).rejects.toThrow();

    expect(await readFile(survivor, "utf-8")).toBe("original");
  });
});

describe("atomic write — JSON formatting + concurrency", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("atomicWriteJsonAsync pretty-prints with a 2-space indent", async () => {
    const target = path.join(dir, "config.json");
    await atomicWriteJsonAsync(target, { name: "warlock", nested: { ok: true } });

    const raw = await readFile(target, "utf-8");
    expect(raw).toBe(
      '{\n  "name": "warlock",\n  "nested": {\n    "ok": true\n  }\n}',
    );
  });

  it("writes an empty string and yields an empty file", async () => {
    const target = path.join(dir, "empty.txt");
    await atomicWriteAsync(target, "");

    expect(await readFile(target, "utf-8")).toBe("");
  });

  it("concurrent writers to distinct targets all land without temp leftovers", async () => {
    // The random temp-suffix design lets independent writers run in parallel
    // without colliding on a shared temp name. (We deliberately do NOT race
    // writers onto the *same* target: rename-over-rename on a single path is a
    // platform-level race the helper makes no serialization guarantee about —
    // Windows can return EPERM there.)
    const count = 8;

    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        atomicWriteAsync(path.join(dir, `writer-${index}.txt`), `content-${index}`),
      ),
    );

    for (let index = 0; index < count; index++) {
      expect(await readFile(path.join(dir, `writer-${index}.txt`), "utf-8")).toBe(
        `content-${index}`,
      );
    }

    // Every temp got renamed; nothing left behind.
    const leftoverTemp = (await readdir(dir)).filter((entry) =>
      entry.endsWith(".tmp"),
    );
    expect(leftoverTemp).toEqual([]);
  });
});
