import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  directoryExistsAsync,
  ensureDirectory,
  ensureDirectoryAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("dirs", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("creates a deep directory in one call", async () => {
    const target = path.join(dir, "a/b/c/d");
    await ensureDirectoryAsync(target);
    expect(await directoryExistsAsync(target)).toBe(true);
  });

  it("is idempotent — calling twice does not throw", async () => {
    const target = path.join(dir, "again");
    await ensureDirectoryAsync(target);
    await ensureDirectoryAsync(target);
    expect(await directoryExistsAsync(target)).toBe(true);
  });

  it("sync ensureDirectory works", async () => {
    const target = path.join(dir, "sync/nested");
    ensureDirectory(target);
    expect(await directoryExistsAsync(target)).toBe(true);
  });
});
