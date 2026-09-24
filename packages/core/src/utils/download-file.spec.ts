import { mkdtemp, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFileFromUrl } from "./download-file";

describe("downloadFileFromUrl", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "dl-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    "http://127.0.0.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:7f00:1]/a.png",
  ])("refuses %s and writes nothing", async (url) => {
    const fetchMock = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadFileFromUrl(url, dir, "a.png")).rejects.toThrow(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  it("does not double-suffix a file name that already has an extension", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { headers: { "content-type": "image/png" } })),
    );

    await downloadFileFromUrl("http://93.184.216.34/pic.png", dir, "avatar.png");

    expect(await readdir(dir)).toEqual(["avatar.png"]);
  });

  it("adds the URL extension once when the name has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x")));

    await downloadFileFromUrl("http://93.184.216.34/pic.png", dir, "avatar");

    expect(await readdir(dir)).toEqual(["avatar.png"]);
  });
});
