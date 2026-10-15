import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  ensureDirectoryAsync,
  listAsync,
  listDirectoriesAsync,
  listFiles,
  listFilesAsync,
  putFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("list", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());

    await putFileAsync(path.join(dir, "a.txt"), "a");
    await putFileAsync(path.join(dir, "b.txt"), "b");
    await ensureDirectoryAsync(path.join(dir, "sub1"));
    await ensureDirectoryAsync(path.join(dir, "sub2"));
  });

  afterEach(() => cleanup());

  it("listAsync returns immediate children (files + dirs)", async () => {
    const entries = (await listAsync(dir)).map(p => path.basename(p)).sort();
    expect(entries).toEqual(["a.txt", "b.txt", "sub1", "sub2"]);
  });

  it("listFilesAsync returns only files", async () => {
    const files = (await listFilesAsync(dir)).map(p => path.basename(p)).sort();
    expect(files).toEqual(["a.txt", "b.txt"]);
  });

  it("listDirectoriesAsync returns only directories", async () => {
    const dirs = (await listDirectoriesAsync(dir)).map(p => path.basename(p)).sort();
    expect(dirs).toEqual(["sub1", "sub2"]);
  });

  it("listFiles (sync) returns only files", () => {
    const files = listFiles(dir).map(p => path.basename(p)).sort();
    expect(files).toEqual(["a.txt", "b.txt"]);
  });
});
