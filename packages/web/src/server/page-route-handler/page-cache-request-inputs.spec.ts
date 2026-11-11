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

import { markLocaleFromPath } from "../page-vary-header";
import { resolvePageCacheHitOrMiss } from "./serve-page-cache-hit";

type FakeRequest = {
  method: string;
  path: string;
  query: Record<string, unknown>;
  locale: string;
  header: (name: string) => unknown;
  site?: { key: string; host?: string; tenantKey?: string };
};

function fakeRequest(overrides: Partial<FakeRequest> & { host?: string } = {}): FakeRequest {
  const host = overrides.host ?? "shop.test";

  return {
    method: "GET",
    path: "/landing",
    query: {},
    locale: "en",
    header: (name: string) => (name === "host" ? host : undefined),
    ...overrides,
  };
}

function fakeResponse() {
  const headers = new Map<string, string>();

  return {
    headers,
    header: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    html: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    setContentType: vi.fn(),
  };
}

const cache = { public: true, maxAge: 60, serverCache: true, tags: ["landing"] } as const;

function lookup(request: FakeRequest, options: { cache?: object; response?: object } = {}) {
  return resolvePageCacheHitOrMiss({
    request: request as never,
    response: (options.response ?? fakeResponse()) as never,
    cache: (options.cache ?? cache) as never,
    credentialedRequest: false,
    pageCacheVariant: "html",
  });
}

beforeEach(() => {
  getPageCacheEntry.mockReset();
  getPageCacheEntry.mockResolvedValue(undefined);
  configValues.clear();
});

describe("page cache key host in multi-site mode", () => {
  it("keys a render on the host site selection chose, not on the raw Host header", async () => {
    // Host says shop.test, but a trusted proxy forwarded evil.test and the
    // site (and every URL in the render) was selected from that.
    const forwarded = await lookup(
      fakeRequest({ host: "shop.test", site: { key: "main", host: "evil.test" } }),
    );
    const ordinary = await lookup(
      fakeRequest({ host: "shop.test", site: { key: "main", host: "shop.test" } }),
    );

    expect(forwarded).toMatchObject({ cacheKey: "evil.test/landing?|en|html|site=main" });
    expect(ordinary).toMatchObject({ cacheKey: "shop.test/landing?|en|html|site=main" });
  });

  it("keeps the request's port, so ordinary keys are unchanged", async () => {
    const outcome = await lookup(
      fakeRequest({ host: "Shop.TEST:8080", site: { key: "main", host: "shop.test" } }),
    );

    expect(outcome).toMatchObject({ cacheKey: "shop.test%3A8080/landing?|en|html|site=main" });
  });
});

describe("page cache with query parameters the key leaves out", () => {
  it("serves a tracking-tagged request but never stores its render", async () => {
    const outcome = await lookup(fakeRequest({ query: { utm_campaign: "<injected>" } }));

    expect(outcome).toMatchObject({
      cacheHeaderValue: "miss",
      cacheKey: "shop.test/landing?|en|html",
      attemptStorageAfterRender: false,
    });
  });

  it("still stores a clean request under the same key", async () => {
    const outcome = await lookup(fakeRequest());

    expect(outcome).toMatchObject({
      cacheKey: "shop.test/landing?|en|html",
      attemptStorageAfterRender: true,
    });
  });

  it("applies a declared cache.query allowlist to the key", async () => {
    const allowlisted = { ...cache, query: ["page"] };
    const first = await lookup(fakeRequest({ query: { page: "2", ref: "x" } }), {
      cache: allowlisted,
    });
    const second = await lookup(fakeRequest({ query: { page: "2", ref: "y" } }), {
      cache: allowlisted,
    });
    const clean = await lookup(fakeRequest({ query: { page: "2" } }), { cache: allowlisted });

    expect(first).toMatchObject({ cacheKey: "shop.test/landing?page=2|en|html" });
    expect(second).toMatchObject({ cacheKey: "shop.test/landing?page=2|en|html" });
    expect(first).toMatchObject({ attemptStorageAfterRender: false });
    expect(clean).toMatchObject({ attemptStorageAfterRender: true });
  });
});

describe("page cache HIT Vary header", () => {
  const storedEntry = {
    body: "<!doctype html><p>cached</p>",
    status: 200,
    contentType: "text/html",
    usesDefer: false,
  };

  it("lists the locale cookie and header when they can change the locale", async () => {
    getPageCacheEntry.mockResolvedValue(storedEntry);
    const response = fakeResponse();

    await lookup(fakeRequest(), { response });

    expect(response.headers.get("Vary")).toBe("x-warlock-data, Cookie, locale");
  });

  it("adds the route's declared varyHeaders", async () => {
    getPageCacheEntry.mockResolvedValue(storedEntry);
    configValues.set("app.localeCodes", ["en"]);
    const response = fakeResponse();

    await lookup(fakeRequest(), { response, cache: { ...cache, varyHeaders: ["x-theme"] } });

    expect(response.headers.get("Vary")).toBe("x-warlock-data, x-theme");
  });

  it("leaves the locale inputs out when the URL pinned the locale", async () => {
    getPageCacheEntry.mockResolvedValue(storedEntry);
    configValues.set("app.localeCodes", ["en", "ar"]);
    const request = fakeRequest();
    markLocaleFromPath(request as never);
    const response = fakeResponse();

    await lookup(request, { response });

    expect(response.headers.get("Vary")).toBe("x-warlock-data");
  });
});
