import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  directoryExists,
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExists,
  fileExistsAsync,
  pathExists,
  pathExistsAsync,
  putFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("exists", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("returns false for non-existent paths", async () => {
    const missing = path.join(dir, "nope.txt");
    expect(await pathExistsAsync(missing)).toBe(false);
    expect(await fileExistsAsync(missing)).toBe(false);
    expect(await directoryExistsAsync(missing)).toBe(false);
    expect(pathExists(missing)).toBe(false);
    expect(fileExists(missing)).toBe(false);
    expect(directoryExists(missing)).toBe(false);
  });

  it("distinguishes files from directories", async () => {
    const filePath = path.join(dir, "real.txt");
    const subdir = path.join(dir, "sub");

    await putFileAsync(filePath, "hello");
    await ensureDirectoryAsync(subdir);

    expect(await fileExistsAsync(filePath)).toBe(true);
    expect(await directoryExistsAsync(filePath)).toBe(false);

    expect(await directoryExistsAsync(subdir)).toBe(true);
    expect(await fileExistsAsync(subdir)).toBe(false);

    // Sync mirrors.
    expect(fileExists(filePath)).toBe(true);
    expect(directoryExists(subdir)).toBe(true);
  });

});
