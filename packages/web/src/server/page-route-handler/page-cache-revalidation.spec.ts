import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPageCacheEntry, configValues } = vi.hoisted(() => ({
  getPageCacheEntry: vi.fn(),
  configValues: new Map<string, unknown>(),
}));

vi.mock("../page-cache-store", () => ({ getPageCacheEntry, setPageCacheEntry: vi.fn() }));
vi.mock("@warlock.js/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  config: { get: (key: string) => configValues.get(key) },
}));

import { encodeForStore, pageCacheEtag } from "../page-cache-encoding";
import { resolvePageCacheHitOrMiss } from "./serve-page-cache-hit";

const BODY = `<!doctype html><html><body>${"hello ".repeat(400)}</body></html>`;
const cache = { public: true, maxAge: 60, serverCache: true, tags: ["landing"] } as const;

function request(headers: Record<string, string> = {}) {
  return {
    method: "GET",
    path: "/landing",
    query: {},
    locale: "en",
    header: (name: string) => (name === "host" ? "shop.test" : headers[name]),
  };
}

function response() {
  const headers = new Map<string, string>();

  return {
    headers,
    header: vi.fn((name: string, value: string) => void headers.set(name, value)),
    html: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    setContentType: vi.fn(),
  };
}

async function serve(headers: Record<string, string>) {
  const reply = response();

  await resolvePageCacheHitOrMiss({
    request: request(headers) as never,
    response: reply as never,
    cache: cache as never,
    credentialedRequest: false,
    pageCacheVariant: "html",
  });

  return reply;
}

beforeEach(async () => {
  configValues.clear();
  configValues.set("http.compression", true);
  getPageCacheEntry.mockReset();
  getPageCacheEntry.mockResolvedValue({
    body: BODY,
    status: 200,
    contentType: "text/html",
    usesDefer: false,
    ...(await encodeForStore(BODY)),
  });
});

describe("page cache HIT revalidation and stored encodings", () => {
  it("answers 304 when If-None-Match names the entry tag", async () => {
    const reply = await serve({ "if-none-match": pageCacheEtag(BODY) });

    expect(reply.send).toHaveBeenCalledWith("", 304);
    expect(reply.headers.get("ETag")).toBe(pageCacheEtag(BODY));
    expect(reply.html).not.toHaveBeenCalled();
  });

  it("sends the stored gzip body without compressing again", async () => {
    const reply = await serve({ "accept-encoding": "gzip" });
    const [body, status] = reply.send.mock.calls[0] as unknown as [Buffer, number];

    expect(status).toBe(200);
    expect(reply.headers.get("Content-Encoding")).toBe("gzip");
    expect(reply.headers.get("Vary")).toMatch(/Accept-Encoding/);
    expect(gunzipSync(body).toString()).toBe(BODY);
  });

  it("sends the plain body, still tagged, to a client that accepts no coding", async () => {
    const reply = await serve({});

    expect(reply.html).toHaveBeenCalledWith(BODY, 200);
    expect(reply.headers.has("Content-Encoding")).toBe(false);
    expect(reply.headers.get("ETag")).toBe(pageCacheEtag(BODY));
  });

  it("stores no compressed form when http.compression is off", async () => {
    configValues.set("http.compression", false);

    expect((await encodeForStore(BODY)).encoded).toBeUndefined();
  });
});
