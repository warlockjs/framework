import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  copyDirectoryAsync,
  copyFileAsync,
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
  renameFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("copy + rename", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("copyFileAsync duplicates contents and creates the destination parent", async () => {
    const src = path.join(dir, "src.txt");
    const dest = path.join(dir, "nested/dest.txt");

    await putFileAsync(src, "warlock");
    await copyFileAsync(src, dest);

    expect(await getFileAsync(dest)).toBe("warlock");
    // Source intact.
    expect(await getFileAsync(src)).toBe("warlock");
  });

  it("copyDirectoryAsync recursively copies a directory tree", async () => {
    const sourceTree = path.join(dir, "source");
    const destTree = path.join(dir, "dest");

    await ensureDirectoryAsync(path.join(sourceTree, "inner"));
    await putFileAsync(path.join(sourceTree, "top.txt"), "top");
    await putFileAsync(path.join(sourceTree, "inner/leaf.txt"), "leaf");

    await copyDirectoryAsync(sourceTree, destTree);

    expect(await getFileAsync(path.join(destTree, "top.txt"))).toBe("top");
    expect(await getFileAsync(path.join(destTree, "inner/leaf.txt"))).toBe("leaf");
  });

  it("renameFileAsync moves a file", async () => {
    const original = path.join(dir, "original.txt");
    const moved = path.join(dir, "moved.txt");

    await putFileAsync(original, "x");
    await renameFileAsync(original, moved);

    expect(await fileExistsAsync(original)).toBe(false);
    expect(await fileExistsAsync(moved)).toBe(true);
  });

  it("renameFileAsync moves a directory", async () => {
    const original = path.join(dir, "before");
    const moved = path.join(dir, "after");

    await ensureDirectoryAsync(original);
    await renameFileAsync(original, moved);

    expect(await directoryExistsAsync(original)).toBe(false);
    expect(await directoryExistsAsync(moved)).toBe(true);
  });
});
