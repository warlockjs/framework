import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import { resolveByteRange } from "./file-range";

const lastModified = new Date("2026-01-01T00:00:00Z");
const etag = '"10-1767225600000"';

function range(header: unknown, extra: { method?: string; ifRange?: unknown; size?: number } = {}) {
  return resolveByteRange({
    method: extra.method ?? "GET",
    range: header,
    ifRange: extra.ifRange,
    etag,
    lastModified,
    size: extra.size ?? 10,
  });
}

describe("resolveByteRange", () => {
  it("resolves single ranges, open ends and suffixes", () => {
    expect(range("bytes=0-3")).toEqual({ start: 0, end: 3 });
    expect(range("bytes=4-")).toEqual({ start: 4, end: 9 });
    expect(range("bytes=-3")).toEqual({ start: 7, end: 9 });
    expect(range("bytes=5-100")).toEqual({ start: 5, end: 9 });
  });

  it("sends the whole file for no range, several ranges, other units or other methods", () => {
    expect(range(undefined)).toBeUndefined();
    expect(range("bytes=0-1,4-5")).toBeUndefined();
    expect(range("items=0-1")).toBeUndefined();
    expect(range("bytes=0-1", { method: "POST" })).toBeUndefined();
    expect(range("bytes=5-2")).toBeUndefined();
  });

  it("is unsatisfiable past the end of the file", () => {
    expect(range("bytes=10-")).toBe("unsatisfiable");
    expect(range("bytes=-0")).toBe("unsatisfiable");
  });

  it("honours If-Range against the strong tag or the date", () => {
    expect(range("bytes=0-1", { ifRange: etag })).toEqual({ start: 0, end: 1 });
    expect(range("bytes=0-1", { ifRange: `W/${etag}` })).toBeUndefined();
    expect(range("bytes=0-1", { ifRange: '"other"' })).toBeUndefined();
    expect(range("bytes=0-1", { ifRange: lastModified.toUTCString() })).toEqual({
      start: 0,
      end: 1,
    });
    expect(range("bytes=0-1", { ifRange: new Date(0).toUTCString() })).toBeUndefined();
  });
});

describe("response.sendFile ranges", () => {
  let harness: HttpHarness | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  async function serve() {
    root = mkdtempSync(path.join(tmpdir(), "warlock-range-"));
    const file = path.join(root, "clip.txt");
    writeFileSync(file, "0123456789abcdefghij");
    const stats = statSync(file);

    harness = await bootHarness((router) => {
      router.get("/clip.txt", ({ response }) => response.sendFile(file));
      router.get("/missing.txt", ({ response }) => response.sendFile(path.join(root!, "nope.txt")));
    });

    return { harness, tag: `"${stats.size}-${stats.mtime.getTime()}"` };
  }

  it("answers Range: bytes=0-9 with 206 and ten bytes", async () => {
    const { harness } = await serve();

    const result = await harness.inject({
      method: "GET",
      url: "/clip.txt",
      headers: { range: "bytes=0-9" },
    });

    expect(result.statusCode).toBe(206);
    expect(result.body).toBe("0123456789");
    expect(result.headers["content-range"]).toBe("bytes 0-9/20");
    expect(result.headers["content-length"]).toBe("10");
    expect(result.headers["accept-ranges"]).toBe("bytes");
  });

  it("sends the whole file without a Range header, or when If-Range is stale", async () => {
    const { harness } = await serve();

    const full = await harness.inject({ method: "GET", url: "/clip.txt" });

    expect(full.statusCode).toBe(200);
    expect(full.body).toBe("0123456789abcdefghij");
    expect(full.headers["content-length"]).toBe("20");

    const stale = await harness.inject({
      method: "GET",
      url: "/clip.txt",
      headers: { range: "bytes=0-1", "if-range": '"old"' },
    });

    expect(stale.statusCode).toBe(200);
    expect(stale.body).toBe("0123456789abcdefghij");
  });

  it("answers an unsatisfiable range with 416", async () => {
    const { harness } = await serve();

    const result = await harness.inject({
      method: "GET",
      url: "/clip.txt",
      headers: { range: "bytes=50-" },
    });

    expect(result.statusCode).toBe(416);
    expect(result.headers["content-range"]).toBe("bytes */20");
  });

  it("answers a missing file with 404", async () => {
    const { harness } = await serve();

    const result = await harness.inject({ method: "GET", url: "/missing.txt" });

    expect(result.statusCode).toBe(404);
  });
});
