import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  copyDirectoryAsync,
  copyFile,
  copyFileAsync,
  ensureDirectoryAsync,
  hashFile,
  hashFileAsync,
  hashFileSmallAsync,
  lastModified,
  lastModifiedAsync,
  listAsync,
  listFiles,
  putFileAsync,
  renameFile,
  renameFileAsync,
  stats,
  statsAsync,
} from "../src/index";
import { withTempDir } from "./helpers";

describe("error paths — missing sources throw", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("copyFileAsync rejects when the source is missing", async () => {
    await expect(
      copyFileAsync(path.join(dir, "nope.txt"), path.join(dir, "out.txt")),
    ).rejects.toThrow();
  });

  it("copyFile (sync) throws when the source is missing", () => {
    expect(() =>
      copyFile(path.join(dir, "nope.txt"), path.join(dir, "out.txt")),
    ).toThrow();
  });

  it("copyDirectoryAsync rejects when the source directory is missing", async () => {
    await expect(
      copyDirectoryAsync(path.join(dir, "nope"), path.join(dir, "dest")),
    ).rejects.toThrow();
  });

  it("renameFileAsync rejects when the source is missing", async () => {
    await expect(
      renameFileAsync(path.join(dir, "nope.txt"), path.join(dir, "to.txt")),
    ).rejects.toThrow();
  });

  it("renameFile (sync) throws when the source is missing", () => {
    expect(() =>
      renameFile(path.join(dir, "nope.txt"), path.join(dir, "to.txt")),
    ).toThrow();
  });

  it("hashFileAsync rejects when the file is missing", async () => {
    await expect(hashFileAsync(path.join(dir, "nope.txt"))).rejects.toThrow();
  });

  it("hashFile (sync) throws when the file is missing", () => {
    expect(() => hashFile(path.join(dir, "nope.txt"))).toThrow();
  });

  it("hashFileSmallAsync rejects when the file is missing", async () => {
    await expect(
      hashFileSmallAsync(path.join(dir, "nope.txt")),
    ).rejects.toThrow();
  });

  it("listAsync rejects when the directory is missing", async () => {
    await expect(listAsync(path.join(dir, "nope"))).rejects.toThrow();
  });

  it("listFiles (sync) throws when the directory is missing", () => {
    expect(() => listFiles(path.join(dir, "nope"))).toThrow();
  });

  it("lastModifiedAsync rejects when the path is missing", async () => {
    await expect(lastModifiedAsync(path.join(dir, "nope"))).rejects.toThrow();
  });

  it("lastModified (sync) throws when the path is missing", () => {
    expect(() => lastModified(path.join(dir, "nope"))).toThrow();
  });

  it("statsAsync rejects when the path is missing", async () => {
    await expect(statsAsync(path.join(dir, "nope"))).rejects.toThrow();
  });

  it("stats (sync) throws when the path is missing", () => {
    expect(() => stats(path.join(dir, "nope"))).toThrow();
  });
});

describe("error paths — ENOENT code is surfaced", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("copyFileAsync surfaces an ENOENT error for a missing source", async () => {
    await expect(
      copyFileAsync(path.join(dir, "nope.txt"), path.join(dir, "out.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("hashFileAsync surfaces an ENOENT error for a missing file", async () => {
    await expect(hashFileAsync(path.join(dir, "nope.txt"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("statsAsync surfaces an ENOENT error for a missing path", async () => {
    await expect(statsAsync(path.join(dir, "nope"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("interplay — copy then verify source preserved across helpers", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("copyDirectoryAsync into an existing destination merges entries", async () => {
    const source = path.join(dir, "source");
    const destination = path.join(dir, "dest");

    await putFileAsync(path.join(source, "from-source.txt"), "s");
    await ensureDirectoryAsync(destination);
    await putFileAsync(path.join(destination, "pre-existing.txt"), "d");

    await copyDirectoryAsync(source, destination);

    const names = (await listAsync(destination))
      .map((entry) => path.basename(entry))
      .sort();
    expect(names).toEqual(["from-source.txt", "pre-existing.txt"]);
  });
});
