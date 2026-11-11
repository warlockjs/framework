import { afterEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "@warlock.js/core";
import type { PageCacheOptIn } from "../routing/route-identity";
import { normalizePageModule } from "./normalize-page-module";
import {
  admitPageCacheEntry,
  DEFAULT_PAGE_CACHE_MAX_ENTRIES_PER_ROUTE,
  InvalidPageCacheMaxEntriesPerRouteError,
  resolvePageCacheMaxEntriesPerRoute,
} from "./page-cache-route-cap";

function route(): PageCacheOptIn {
  return { public: true, maxAge: 60, serverCache: true, tags: ["posts"] };
}

afterEach(() => {
  setConfig("pageCache.maxEntriesPerRoute", undefined as never);
  vi.restoreAllMocks();
});

describe("pageCache.maxEntriesPerRoute", () => {
  it("defaults to 1,000 stored variants per route", () => {
    expect(resolvePageCacheMaxEntriesPerRoute()).toBe(DEFAULT_PAGE_CACHE_MAX_ENTRIES_PER_ROUTE);
    expect(DEFAULT_PAGE_CACHE_MAX_ENTRIES_PER_ROUTE).toBe(1_000);
  });

  it("stores at most the ceiling's worth of distinct query variants on one route", () => {
    setConfig("pageCache.maxEntriesPerRoute", 100);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = route();
    let admitted = 0;

    for (let n = 0; n < 2_000; n++) {
      if (admitPageCacheEntry(cache, `a.test/?n=${n}|en|html`, 60, 0)) admitted++;
    }

    expect(admitted).toBe(100);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshing a variant it already stores, and counts each route separately", () => {
    setConfig("pageCache.maxEntriesPerRoute", 1);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = route();

    expect(admitPageCacheEntry(cache, "first", 60, 0)).toBe(true);
    expect(admitPageCacheEntry(cache, "first", 60, 1_000)).toBe(true);
    expect(admitPageCacheEntry(cache, "second", 60, 1_000)).toBe(false);
    expect(admitPageCacheEntry(route(), "second", 60, 1_000)).toBe(true);
  });

  it("frees a slot once its entry's TTL has ended", () => {
    setConfig("pageCache.maxEntriesPerRoute", 1);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = route();

    expect(admitPageCacheEntry(cache, "first", 60, 0)).toBe(true);
    expect(admitPageCacheEntry(cache, "second", 60, 30_000)).toBe(false);
    expect(admitPageCacheEntry(cache, "second", 60, 60_000)).toBe(true);
  });

  it("false removes the ceiling", () => {
    setConfig("pageCache.maxEntriesPerRoute", false);
    const cache = route();

    for (let n = 0; n < 1_500; n++) {
      expect(admitPageCacheEntry(cache, `k${n}`, 60, 0)).toBe(true);
    }
  });

  it("rejects a value that is not a positive integer or false", () => {
    setConfig("pageCache.maxEntriesPerRoute", 0);

    expect(() => resolvePageCacheMaxEntriesPerRoute()).toThrow(
      InvalidPageCacheMaxEntriesPerRouteError,
    );
  });
});

describe("config.cache query and varyHeaders", () => {
  const Page = () => null;

  it("accepts a cache.query allowlist and varyHeaders", () => {
    const normalized = normalizePageModule(
      {
        default: Page,
        config: {
          cache: {
            public: true,
            maxAge: 60,
            serverCache: true,
            tags: ["p"],
            query: ["page"],
            varyHeaders: ["x-theme"],
          },
        },
      },
      "page",
      "src/web/posts.page.tsx",
    );

    expect(normalized.cache).toMatchObject({ query: ["page"], varyHeaders: ["x-theme"] });
  });

  it("rejects a cache.query that is not a list of names", () => {
    expect(() =>
      normalizePageModule(
        { default: Page, config: { cache: { public: true, maxAge: 60, query: "page" } } },
        "page",
        "src/web/posts.page.tsx",
      ),
    ).toThrow(/config\.cache\.query/);
  });

  it("rejects a varyHeaders entry that is not a header name", () => {
    expect(() =>
      normalizePageModule(
        {
          default: Page,
          config: { cache: { public: true, maxAge: 60, varyHeaders: ["x theme"] } },
        },
        "page",
        "src/web/posts.page.tsx",
      ),
    ).toThrow(/config\.cache\.varyHeaders/);
  });
});
