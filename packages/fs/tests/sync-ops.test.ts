import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  copyDirectory,
  copyFile,
  directoryExists,
  ensureDirectory,
  fileExists,
  getFile,
  listDirectories,
  putFile,
  removeDirectory,
  renameFile,
  unlink,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("synchronous file operations", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("copyFile (sync) duplicates contents and creates the destination parent", () => {
    const source = path.join(dir, "source.txt");
    const destination = path.join(dir, "nested/dest.txt");

    putFile(source, "warlock");
    copyFile(source, destination);

    expect(getFile(destination)).toBe("warlock");
    expect(getFile(source)).toBe("warlock");
  });

  it("copyDirectory (sync) recursively copies a tree", () => {
    const sourceTree = path.join(dir, "source");
    const destinationTree = path.join(dir, "dest");

    putFile(path.join(sourceTree, "inner/leaf.txt"), "leaf");
    copyDirectory(sourceTree, destinationTree);

    expect(getFile(path.join(destinationTree, "inner/leaf.txt"))).toBe("leaf");
  });

  it("renameFile (sync) moves a file", () => {
    const original = path.join(dir, "original.txt");
    const moved = path.join(dir, "moved.txt");

    putFile(original, "x");
    renameFile(original, moved);

    expect(fileExists(original)).toBe(false);
    expect(fileExists(moved)).toBe(true);
  });

  it("listDirectories (sync) returns only directories", () => {
    putFile(path.join(dir, "a.txt"), "a");
    ensureDirectory(path.join(dir, "sub1"));
    ensureDirectory(path.join(dir, "sub2"));

    const directories = listDirectories(dir).map((entry) => path.basename(entry)).sort();

    expect(directories).toEqual(["sub1", "sub2"]);
  });

  it("unlink (sync) deletes an existing file", () => {
    const target = path.join(dir, "gone.txt");

    putFile(target, "x");
    unlink(target);

    expect(fileExists(target)).toBe(false);
  });

  it("removeDirectory (sync) deletes a tree recursively", () => {
    const tree = path.join(dir, "tree");

    putFile(path.join(tree, "deep/leaf.txt"), "leaf");
    removeDirectory(tree);

    expect(directoryExists(tree)).toBe(false);
  });
});
