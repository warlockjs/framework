import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExistsAsync,
  lastModified,
  lastModifiedAsync,
  listAsync,
  listDirectories,
  listDirectoriesAsync,
  listFiles,
  listFilesAsync,
  putFileAsync,
  removeDirectory,
  removeDirectoryAsync,
  stats,
  statsAsync,
} from "../src/index";
import { withTempDir } from "./helpers";

describe("list — empty directory", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("listAsync returns an empty array for an empty directory", async () => {
    expect(await listAsync(dir)).toEqual([]);
  });

  it("listFilesAsync / listDirectoriesAsync are empty for an empty directory", async () => {
    expect(await listFilesAsync(dir)).toEqual([]);
    expect(await listDirectoriesAsync(dir)).toEqual([]);
  });

  it("returns absolute paths joined under the directory", async () => {
    await putFileAsync(path.join(dir, "only.txt"), "x");

    const [entry] = await listAsync(dir);
    expect(entry).toBe(path.join(dir, "only.txt"));
  });

  it("listFiles (sync) ignores subdirectories", async () => {
    await putFileAsync(path.join(dir, "keep.txt"), "x");
    await ensureDirectoryAsync(path.join(dir, "ignored"));

    expect(listFiles(dir).map((entry) => path.basename(entry))).toEqual([
      "keep.txt",
    ]);
  });

  it("listDirectories (sync) ignores files", async () => {
    await putFileAsync(path.join(dir, "ignored.txt"), "x");
    await ensureDirectoryAsync(path.join(dir, "keep"));

    expect(listDirectories(dir).map((entry) => path.basename(entry))).toEqual([
      "keep",
    ]);
  });
});

describe("stats — size, directories, mtime", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("reports the byte size of written content", async () => {
    const target = path.join(dir, "sized.txt");
    await putFileAsync(target, "héllo"); // 6 bytes UTF-8 (é = 2 bytes)

    expect((await statsAsync(target)).size).toBe(6);
  });

  it("stats (sync) marks a directory as a directory and not a file", async () => {
    const subdir = path.join(dir, "folder");
    await ensureDirectoryAsync(subdir);

    const result = stats(subdir);
    expect(result.isDirectory()).toBe(true);
    expect(result.isFile()).toBe(false);
  });

  it("lastModified reflects a later write as a non-decreasing mtime", async () => {
    const target = path.join(dir, "touch.txt");
    await putFileAsync(target, "v1");
    const first = await lastModifiedAsync(target);

    // Force a measurably later mtime, then rewrite.
    await new Promise((resolve) => setTimeout(resolve, 15));
    await putFileAsync(target, "v2-longer");
    const second = lastModified(target);

    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });
});

describe("remove — directory helpers tolerate odd inputs", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("removeDirectoryAsync also deletes a file path (rm force+recursive)", async () => {
    // Documented behavior: removeDirectory* uses { recursive: true, force: true },
    // which removes a regular file too, not just directories.
    const target = path.join(dir, "actually-a-file.txt");
    await putFileAsync(target, "x");

    await removeDirectoryAsync(target);
    expect(await fileExistsAsync(target)).toBe(false);
  });

  it("removeDirectory (sync) deletes a populated tree and tolerates re-removal", async () => {
    const tree = path.join(dir, "tree");
    await putFileAsync(path.join(tree, "deep/leaf.txt"), "leaf");

    removeDirectory(tree);
    expect(await directoryExistsAsync(tree)).toBe(false);

    // force: true means a second removal of the now-missing path is a no-op.
    expect(() => removeDirectory(tree)).not.toThrow();
  });
});
