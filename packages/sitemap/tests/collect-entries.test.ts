import { describe, expect, it } from "vitest";
import { collectSitemapEntries, isDynamicRoutePath } from "../src/collect-entries";
import type { RoutablePage } from "../src/routable-page";

describe("isDynamicRoutePath", () => {
  it("recognises a :param segment", () => {
    expect(isDynamicRoutePath("/posts/:id")).toBe(true);
  });

  it("treats a static path as not dynamic", () => {
    expect(isDynamicRoutePath("/about")).toBe(false);
  });
});

describe("collectSitemapEntries", () => {
  it("includes a static route", async () => {
    const pages: RoutablePage[] = [{ routeName: "about", routePath: "/about" }];

    const { entries } = await collectSitemapEntries(pages);

    expect(entries).toEqual([{ path: "/about", changefreq: undefined, priority: undefined }]);
  });

  it("excludes a page whose metadata.robots says noindex", async () => {
    const pages: RoutablePage[] = [{ routeName: "hidden", routePath: "/hidden", robots: "noindex" }];

    const { entries } = await collectSitemapEntries(pages);

    expect(entries).toHaveLength(0);
  });

  it("excludes a page exporting sitemap: false", async () => {
    const pages: RoutablePage[] = [{ routeName: "draft", routePath: "/draft", sitemap: false }];

    const { entries } = await collectSitemapEntries(pages);

    expect(entries).toHaveLength(0);
  });

  it("includes the entries a dynamic route's sitemap export returns", async () => {
    const pages: RoutablePage[] = [
      {
        routeName: "post-details",
        routePath: "/posts/:id",
        sitemap: async () => [
          { path: "/posts/hello-world", lastmod: "2026-09-17", priority: 0.8 },
          { path: "/posts/second-post" },
        ],
      },
    ];

    const { entries, unresolvedDynamicRoutes } = await collectSitemapEntries(pages);

    expect(entries.map((entry) => entry.path)).toEqual(["/posts/hello-world", "/posts/second-post"]);
    expect(unresolvedDynamicRoutes).toHaveLength(0);
  });

  it("omits a dynamic route with no sitemap export AND names it in unresolvedDynamicRoutes", async () => {
    const pages: RoutablePage[] = [{ routeName: "product-details", routePath: "/products/:id" }];

    const { entries, unresolvedDynamicRoutes } = await collectSitemapEntries(pages);

    expect(entries).toHaveLength(0);
    expect(unresolvedDynamicRoutes).toEqual(["product-details"]);
  });

  it("applies defaults when an entry omits changefreq/priority", async () => {
    const pages: RoutablePage[] = [{ routeName: "about", routePath: "/about" }];

    const { entries } = await collectSitemapEntries(pages, {
      defaults: { changefreq: "weekly", priority: 0.5 },
    });

    expect(entries).toEqual([{ path: "/about", changefreq: "weekly", priority: 0.5 }]);
  });

  it("keeps an entry's own changefreq/priority over the defaults", async () => {
    const pages: RoutablePage[] = [
      {
        routeName: "post-details",
        routePath: "/posts/:id",
        sitemap: async () => [{ path: "/posts/hello-world", changefreq: "daily", priority: 0.9 }],
      },
    ];

    const { entries } = await collectSitemapEntries(pages, {
      defaults: { changefreq: "weekly", priority: 0.5 },
    });

    expect(entries).toEqual([{ path: "/posts/hello-world", changefreq: "daily", priority: 0.9 }]);
  });
});
