import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  hashBuffer,
  hashFile,
  hashFileAsync,
  hashFileSmallAsync,
  hashString,
  putFileAsync,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("hash", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("hashFileAsync matches a known sha256", async () => {
    const target = path.join(dir, "input.txt");
    await putFileAsync(target, "hello");

    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const digest = await hashFileAsync(target);
    expect(digest).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("hashFile (sync) matches hashFileAsync", async () => {
    const target = path.join(dir, "match.txt");
    await putFileAsync(target, "warlock");

    expect(hashFile(target)).toBe(await hashFileAsync(target));
  });

  it("hashFileSmallAsync matches hashFileAsync", async () => {
    const target = path.join(dir, "small.txt");
    await putFileAsync(target, "warlock");

    expect(await hashFileSmallAsync(target)).toBe(await hashFileAsync(target));
  });

  it("hashString returns the same digest as hashing the file", async () => {
    const target = path.join(dir, "equal.txt");
    await putFileAsync(target, "round-trip");

    expect(hashString("round-trip")).toBe(await hashFileAsync(target));
  });

  it("hashBuffer matches hashString for equivalent input", () => {
    const fromString = hashString("warlock");
    const fromBuffer = hashBuffer(Buffer.from("warlock", "utf-8"));
    expect(fromString).toBe(fromBuffer);
  });

  it("respects the algorithm argument", async () => {
    const target = path.join(dir, "alg.txt");
    await putFileAsync(target, "hello");

    // md5("hello") = 5d41402abc4b2a76b9719d911017c592
    expect(await hashFileAsync(target, "md5")).toBe("5d41402abc4b2a76b9719d911017c592");
  });
});
