import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteAsync } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("atomic write — buffers and cleanup", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(() => cleanup());

  it("writes raw Buffer content byte-for-byte", async () => {
    const target = path.join(dir, "blob.bin");
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);

    await atomicWriteAsync(target, bytes);

    const written = await readFile(target);

    expect(written.equals(bytes)).toBe(true);
  });

  it("leaves no temp files behind after overwriting an existing file", async () => {
    const target = path.join(dir, "state.txt");

    await atomicWriteAsync(target, "v1");
    await atomicWriteAsync(target, "v2");

    const entries = await readdir(dir);

    expect(entries).toEqual(["state.txt"]);
  });
});
