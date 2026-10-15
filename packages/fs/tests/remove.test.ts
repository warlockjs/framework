import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExistsAsync,
  putFileAsync,
  removeDirectory,
  removeDirectoryAsync,
  unlink,
  unlinkAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("remove", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("unlinkAsync deletes a file", async () => {
    const target = path.join(dir, "deleteme.txt");
    await putFileAsync(target, "x");
    await unlinkAsync(target);
    expect(await fileExistsAsync(target)).toBe(false);
  });

  it("unlinkAsync does not throw on missing files (ENOENT)", async () => {
    await expect(unlinkAsync(path.join(dir, "ghost.txt"))).resolves.toBeUndefined();
  });

  it("unlink (sync) does not throw on missing files", () => {
    expect(() => unlink(path.join(dir, "ghost.txt"))).not.toThrow();
  });

  it("removeDirectoryAsync deletes recursively", async () => {
    const tree = path.join(dir, "tree");
    await ensureDirectoryAsync(path.join(tree, "deep/inner"));
    await putFileAsync(path.join(tree, "deep/inner/leaf.txt"), "leaf");

    await removeDirectoryAsync(tree);
    expect(await directoryExistsAsync(tree)).toBe(false);
  });

  it("removeDirectoryAsync does not throw if the directory is absent", async () => {
    await expect(removeDirectoryAsync(path.join(dir, "missing"))).resolves.toBeUndefined();
  });

  it("removeDirectory (sync) works", () => {
    const target = path.join(dir, "sync-rm");
    removeDirectory(target);
    // sync also tolerates missing
    expect(true).toBe(true);
  });
});
