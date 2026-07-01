import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  hashBuffer,
  hashFile,
  hashFileAsync,
  hashFileSmallAsync,
  hashString,
  putFileAsync,
} from "../src/index";
import { withTempDir } from "./helpers";

// Known empty-input digests (no bytes hashed).
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e";

describe("hash — empty + boundary inputs", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("hashString of an empty string is the known empty sha256", () => {
    expect(hashString("")).toBe(EMPTY_SHA256);
  });

  it("hashBuffer of an empty buffer is the known empty md5", () => {
    expect(hashBuffer(Buffer.alloc(0), "md5")).toBe(EMPTY_MD5);
  });

  it("hashFileAsync of an empty file is the known empty sha256", async () => {
    const target = path.join(dir, "empty.bin");
    await putFileAsync(target, "");

    expect(await hashFileAsync(target)).toBe(EMPTY_SHA256);
  });

  it("hashFile (sync) of an empty file matches the streaming variant", async () => {
    const target = path.join(dir, "empty-sync.bin");
    await putFileAsync(target, "");

    expect(hashFile(target)).toBe(await hashFileAsync(target));
    expect(await hashFileSmallAsync(target)).toBe(EMPTY_SHA256);
  });

  it("hashBuffer accepts a Uint8Array view and agrees with hashString", () => {
    const bytes = new TextEncoder().encode("warlock");
    expect(hashBuffer(bytes)).toBe(hashString("warlock"));
  });

  it("all three streaming/one-shot/sync file hashers agree on real content", async () => {
    const target = path.join(dir, "agree.txt");
    await putFileAsync(target, "the quick brown fox");

    const streaming = await hashFileAsync(target);
    const oneShot = await hashFileSmallAsync(target);
    const sync = hashFile(target);

    expect(oneShot).toBe(streaming);
    expect(sync).toBe(streaming);
  });
});
