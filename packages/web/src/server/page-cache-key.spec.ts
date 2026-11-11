import { describe, expect, it } from "vitest";
import {
  computePageCacheKey,
  hasUnkeyedQueryParams,
  type PageCacheKeyInput,
} from "./page-cache-key";

const base: PageCacheKeyInput = {
  host: "alpha.test",
  path: "/products",
  query: {},
  locale: "en",
  variant: "html",
};

describe("computePageCacheKey — tenant isolation", () => {
  it("keeps a no-site key byte-identical to the legacy format", () => {
    expect(computePageCacheKey(base)).toBe("alpha.test/products?|en|html");
  });

  it("partitions tenants within the same site", () => {
    expect(computePageCacheKey({ ...base, site: "tenant", tenantKey: "acme" })).not.toBe(
      computePageCacheKey({ ...base, site: "tenant", tenantKey: "globex" }),
    );
  });

  it("partitions sites even when their tenant keys match", () => {
    expect(computePageCacheKey({ ...base, site: "landing", tenantKey: "acme" })).not.toBe(
      computePageCacheKey({ ...base, site: "tenant", tenantKey: "acme" }),
    );
  });

  it("encodes site and tenant segments independently", () => {
    expect(computePageCacheKey({ ...base, site: "a,tenant=b" })).not.toBe(
      computePageCacheKey({ ...base, site: "a", tenantKey: "b" }),
    );
  });

  it("separates changed route copy from prior JSON and legacy cache entries", () => {
    const first = computePageCacheKey({ ...base, translationsRevision: "one" });
    expect(first).not.toBe(computePageCacheKey({ ...base, translationsRevision: "two" }));
    expect(first).not.toBe(computePageCacheKey(base));
  });
  it("gives two hosts serving the same URL two different keys", () => {
    expect(computePageCacheKey(base)).not.toBe(computePageCacheKey({ ...base, host: "beta.test" }));
  });

  it("treats host case as irrelevant, the way DNS does", () => {
    expect(computePageCacheKey({ ...base, host: "Alpha.TEST" })).toBe(computePageCacheKey(base));
  });

  it("keeps the port, since two ports on one host can be two different apps", () => {
    expect(computePageCacheKey({ ...base, host: "alpha.test:8080" })).not.toBe(
      computePageCacheKey(base),
    );
  });

  it("gives two varyBy values on the same host two different keys", () => {
    expect(computePageCacheKey({ ...base, vary: "theme=a" })).not.toBe(
      computePageCacheKey({ ...base, vary: "theme=b" }),
    );
  });

  it("does not let a crafted path collide with another host's key", () => {
    const crafted = computePageCacheKey({ ...base, host: "alpha.test", path: "/x" });
    const other = computePageCacheKey({ ...base, host: "alpha.test/x", path: "/" });

    expect(crafted).not.toBe(other);
  });

  it("still collides for identical inputs", () => {
    expect(computePageCacheKey({ ...base, vary: "v" })).toBe(
      computePageCacheKey({ ...base, vary: "v" }),
    );
  });
});

describe("computePageCacheKey — query bounds", () => {
  const base = { host: "a.test", path: "/p", locale: "en", variant: "html" } as const;

  it("ignores tracking params by default", () => {
    expect(
      computePageCacheKey({ ...base, query: { utm_source: "x", fbclid: "1", page: "2" } }),
    ).toBe(computePageCacheKey({ ...base, query: { page: "2" } }));
  });

  it("keeps only allowlisted keys when an allowlist is set", () => {
    expect(
      computePageCacheKey({ ...base, query: { x: "random", page: "2" }, queryAllowlist: ["page"] }),
    ).toBe(computePageCacheKey({ ...base, query: { page: "2" }, queryAllowlist: ["page"] }));
  });
});

describe("computePageCacheKey — nested query values", () => {
  const base = { host: "a.test", path: "/posts", locale: "en", variant: "html" } as const;

  it("gives different nested filters different keys", () => {
    expect(computePageCacheKey({ ...base, query: { filter: { status: "draft" } } })).not.toBe(
      computePageCacheKey({ ...base, query: { filter: { status: "published" } } }),
    );
  });

  it("gives different arrays of objects different keys", () => {
    expect(computePageCacheKey({ ...base, query: { items: [{ a: 1 }] } })).not.toBe(
      computePageCacheKey({ ...base, query: { items: [{ a: 2 }] } }),
    );
  });

  it("serialises nested keys in sorted order, so their order does not split entries", () => {
    expect(computePageCacheKey({ ...base, query: { filter: { b: "2", a: "1" } } })).toBe(
      computePageCacheKey({ ...base, query: { filter: { a: "1", b: "2" } } }),
    );
  });

  it("keeps scalar and scalar-array keys exactly as before", () => {
    expect(computePageCacheKey({ ...base, query: { page: "2", tag: ["x", "y"] } })).toBe(
      "a.test/posts?page=2&tag=x&tag=y|en|html",
    );
  });
});

describe("hasUnkeyedQueryParams", () => {
  it("reports a tracking parameter the key drops", () => {
    expect(hasUnkeyedQueryParams({ utm_source: "x", page: "2" }, undefined)).toBe(true);
    expect(hasUnkeyedQueryParams({ page: "2" }, undefined)).toBe(false);
  });

  it("reports a parameter outside the route's allowlist", () => {
    expect(hasUnkeyedQueryParams({ page: "2", ref: "mail" }, ["page"])).toBe(true);
    expect(hasUnkeyedQueryParams({ page: "2" }, ["page"])).toBe(false);
  });
});
