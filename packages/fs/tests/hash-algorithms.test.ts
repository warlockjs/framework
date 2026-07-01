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

describe("hash — algorithm coverage", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("hashString matches a known sha1 digest", () => {
    // sha1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
    expect(hashString("hello", "sha1")).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });

  it("hashString matches a known sha512 digest", () => {
    const expected =
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7" +
      "2323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043";

    expect(hashString("hello", "sha512")).toBe(expected);
  });

  it("hashFile (sync) agrees with hashFileAsync for sha512", async () => {
    const target = path.join(dir, "alg.txt");
    await putFileAsync(target, "warlock");

    expect(hashFile(target, "sha512")).toBe(await hashFileAsync(target, "sha512"));
  });

  it("hashFileSmallAsync agrees with the streaming variant for sha1", async () => {
    const target = path.join(dir, "small.txt");
    await putFileAsync(target, "warlock");

    expect(await hashFileSmallAsync(target, "sha1")).toBe(await hashFileAsync(target, "sha1"));
  });

  it("hashBuffer and hashString agree across algorithms", () => {
    for (const algorithm of ["sha1", "sha512", "md5"] as const) {
      expect(hashBuffer(Buffer.from("warlock", "utf-8"), algorithm)).toBe(
        hashString("warlock", algorithm),
      );
    }
  });

  it("different algorithms produce different digests for the same input", () => {
    const sha256 = hashString("warlock", "sha256");
    const md5 = hashString("warlock", "md5");

    expect(sha256).not.toBe(md5);
  });
});
