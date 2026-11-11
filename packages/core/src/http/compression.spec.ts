import config from "@mongez/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import {
  createFlushingCompressor,
  isCompressibleType,
  mergeVaryAcceptEncoding,
  negotiateEncoding,
  resolveCompressionConfig,
} from "./compression";
import type { PipeableReactStream } from "./stream-react-response";

const bigBody = { items: Array.from({ length: 300 }, (_, index) => ({ index, label: "item" })) };

function headerTarget(initial: Record<string, unknown> = {}) {
  const headers = new Map(
    Object.entries(initial).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    headers,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    header: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    removeHeader: (name: string) => headers.delete(name.toLowerCase()),
  };
}

describe("resolveCompressionConfig", () => {
  it("is off unless enabled", () => {
    expect(resolveCompressionConfig(undefined)).toBeUndefined();
    expect(resolveCompressionConfig(false)).toBeUndefined();
    expect(resolveCompressionConfig(true)).toEqual({ threshold: 1024, brotli: true });
    expect(resolveCompressionConfig({ threshold: 10, brotli: false })).toEqual({
      threshold: 10,
      brotli: false,
    });
  });

  it("rejects a value of the wrong shape, naming the option", () => {
    expect(() => resolveCompressionConfig("yes")).toThrow(/http\.compression/);
    expect(() => resolveCompressionConfig({ threshold: -1 })).toThrow(/threshold/);
  });
});

describe("negotiateEncoding", () => {
  it("prefers br, then gzip, and honours q-values", () => {
    expect(negotiateEncoding("gzip, deflate, br", true)).toBe("br");
    expect(negotiateEncoding("gzip, deflate, br", false)).toBe("gzip");
    expect(negotiateEncoding("br;q=0.5, gzip", true)).toBe("gzip");
    expect(negotiateEncoding("*", true)).toBe("br");
    expect(negotiateEncoding("gzip;q=0, br;q=0", true)).toBeUndefined();
    expect(negotiateEncoding("identity", true)).toBeUndefined();
    expect(negotiateEncoding(undefined, true)).toBeUndefined();
  });
});

describe("isCompressibleType", () => {
  it("accepts text-like types and refuses streams and binary", () => {
    expect(isCompressibleType("application/json; charset=utf-8")).toBe(true);
    expect(isCompressibleType("text/html")).toBe(true);
    expect(isCompressibleType("application/problem+json")).toBe(true);
    expect(isCompressibleType("image/svg+xml")).toBe(true);
    expect(isCompressibleType("text/event-stream")).toBe(false);
    expect(isCompressibleType("application/x-ndjson")).toBe(false);
    expect(isCompressibleType("image/png")).toBe(false);
    expect(isCompressibleType(undefined)).toBe(false);
  });
});

describe("mergeVaryAcceptEncoding", () => {
  it("adds to the existing Vary value instead of a second header", () => {
    const target = headerTarget({ vary: "Accept, User-Agent" });

    mergeVaryAcceptEncoding(target);
    mergeVaryAcceptEncoding(target);

    expect(target.getHeader("vary")).toBe("Accept, User-Agent, Accept-Encoding");
  });

  it("leaves Vary: * alone", () => {
    const target = headerTarget({ vary: "*" });

    mergeVaryAcceptEncoding(target);

    expect(target.getHeader("vary")).toBe("*");
  });
});

describe("createFlushingCompressor", () => {
  it("flushes each burst of writes so it can be decoded before the stream ends", async () => {
    const raw = new PassThrough();
    const received: Buffer[] = [];
    const decoded: string[] = [];
    const gunzip = zlib.createGunzip();

    raw.on("data", (chunk: Buffer) => received.push(chunk));
    raw.pipe(gunzip);
    gunzip.on("data", (chunk: Buffer) => decoded.push(chunk.toString()));

    const destination = createFlushingCompressor(raw, "gzip");

    destination.write("<html><body>shell");

    // The shell is readable while the stream is still open. The flush runs on the
    // zlib thread pool, so wait for it instead of assuming how long it takes.
    await vi.waitFor(() => expect(decoded.join("")).toBe("<html><body>shell"), { timeout: 5000 });
    expect(raw.writableEnded).toBe(false);

    destination.end("<script>deferred</script></body></html>");

    await new Promise((resolve) => gunzip.once("end", resolve));

    expect(decoded.join("")).toBe("<html><body>shell<script>deferred</script></body></html>");
    expect(received.length).toBeGreaterThan(1);
  });
});

describe("http.compression", () => {
  let harness: HttpHarness | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    config.set("http.compression", undefined);
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  async function boot(register: Parameters<typeof bootHarness>[0]) {
    harness = await bootHarness(register);

    return harness;
  }

  it("is off by default", async () => {
    const server = await boot((router) => {
      router.get("/data", ({ response }) => response.success(bigBody));
    });

    const result = await server.inject({
      method: "GET",
      url: "/data",
      headers: { "accept-encoding": "br, gzip" },
    });

    expect(result.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(result.body)).toEqual(bigBody);
  });

  it("compresses a large JSON body with the negotiated coding", async () => {
    config.set("http.compression", true);

    const server = await boot((router) => {
      router.get("/data", ({ response }) => response.success(bigBody));
    });

    const brotli = await server.inject({
      method: "GET",
      url: "/data",
      headers: { "accept-encoding": "gzip, br" },
    });

    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(brotli.headers.vary).toContain("Accept-Encoding");
    expect(Number(brotli.headers["content-length"])).toBe(brotli.rawPayload.length);
    expect(JSON.parse(zlib.brotliDecompressSync(brotli.rawPayload).toString())).toEqual(bigBody);

    const gzip = await server.inject({
      method: "GET",
      url: "/data",
      headers: { "accept-encoding": "gzip" },
    });

    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(zlib.gunzipSync(gzip.rawPayload).toString())).toEqual(bigBody);

    const identity = await server.inject({ method: "GET", url: "/data" });

    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.headers.vary).toContain("Accept-Encoding");
    expect(JSON.parse(identity.body)).toEqual(bigBody);
  });

  it("only offers gzip when brotli is off", async () => {
    config.set("http.compression", { brotli: false });

    const server = await boot((router) => {
      router.get("/data", ({ response }) => response.success(bigBody));
    });

    const result = await server.inject({
      method: "GET",
      url: "/data",
      headers: { "accept-encoding": "br, gzip" },
    });

    expect(result.headers["content-encoding"]).toBe("gzip");
  });

  it("sends small bodies, HEAD and event streams as they are", async () => {
    config.set("http.compression", true);

    const server = await boot((router) => {
      router.get("/small", ({ response }) => response.success({ ok: true }));
      router.get("/html", ({ response }) => response.html("<p>x</p>".repeat(400)));
      router.get("/events", ({ response }) => {
        const sse = response.sse();
        sse.send("message", { text: "x".repeat(4000) });
        return sse.end();
      });
    });

    const headers = { "accept-encoding": "br, gzip" };

    const small = await server.inject({ method: "GET", url: "/small", headers });
    expect(small.headers["content-encoding"]).toBeUndefined();

    const head = await server.inject({ method: "HEAD", url: "/html", headers });
    expect(head.headers["content-encoding"]).toBeUndefined();

    const events = await server.inject({ method: "GET", url: "/events", headers });
    expect(events.headers["content-encoding"]).toBeUndefined();
    expect(events.body).toContain("event: message");
  });

  it("keeps an existing Vary header as one merged header", async () => {
    config.set("http.compression", true);

    const server = await boot((router) => {
      router.get("/page", ({ response }) => {
        response.header("Vary", "Accept");

        return response.html("<p>x</p>".repeat(400));
      });
    });

    const result = await server.inject({
      method: "GET",
      url: "/page",
      headers: { "accept-encoding": "gzip" },
    });

    expect(result.headers.vary).toBe("Accept, Accept-Encoding");
    expect(result.headers["content-encoding"]).toBe("gzip");
  });

  it("leaves a response that already set Content-Encoding untouched", async () => {
    config.set("http.compression", true);
    const precompressed = zlib.gzipSync(JSON.stringify(bigBody));

    const server = await boot((router) => {
      router.get("/pre", ({ response }) =>
        response
          .header("Content-Encoding", "gzip")
          .sendBuffer(precompressed, { contentType: "application/json" }),
      );
    });

    const result = await server.inject({
      method: "GET",
      url: "/pre",
      headers: { "accept-encoding": "br" },
    });

    expect(result.headers["content-encoding"]).toBe("gzip");
    expect(result.rawPayload.equals(precompressed)).toBe(true);
  });

  it("compresses a text file and turns its ETag weak", async () => {
    config.set("http.compression", true);
    root = mkdtempSync(path.join(tmpdir(), "warlock-compression-"));
    const file = path.join(root, "notes.txt");
    const text = "line of text\n".repeat(500);
    writeFileSync(file, text);

    const server = await boot((router) => {
      router.get("/notes.txt", ({ response }) => response.sendFile(file));
    });

    const result = await server.inject({
      method: "GET",
      url: "/notes.txt",
      headers: { "accept-encoding": "gzip" },
    });

    expect(result.headers["content-encoding"]).toBe("gzip");
    expect(result.headers["content-length"]).toBeUndefined();
    expect(String(result.headers.etag)).toMatch(/^W\/"/);
    expect(zlib.gunzipSync(result.rawPayload).toString()).toBe(text);

    // The weak tag still revalidates.
    const revalidated = await server.inject({
      method: "GET",
      url: "/notes.txt",
      headers: { "accept-encoding": "gzip", "if-none-match": String(result.headers.etag) },
    });

    expect(revalidated.statusCode).toBe(304);
  });

  it("compresses a streamed React document", async () => {
    config.set("http.compression", true);
    const html = `<!doctype html><html><body>${"<p>streamed</p>".repeat(200)}</body></html>`;
    const pipeable: PipeableReactStream = {
      pipe(destination) {
        destination.write(html.slice(0, 100));
        setImmediate(() => destination.end(html.slice(100)));

        return destination;
      },
      abort() {},
    };

    const server = await boot((router) => {
      router.get("/doc", async ({ response }) => {
        response.setContentType("text/html");
        await response.streamReact(pipeable);
      });
    });

    const result = await server.inject({
      method: "GET",
      url: "/doc",
      headers: { "accept-encoding": "br" },
    });

    expect(result.headers["content-encoding"]).toBe("br");
    expect(result.headers.vary).toContain("Accept-Encoding");
    expect(zlib.brotliDecompressSync(result.rawPayload).toString()).toBe(html);
  });
});
