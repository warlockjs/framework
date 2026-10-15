import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SitemapIndex } from "../src/sitemap-index";

describe("versioned sitemap shard URLs", () => {
  it("points an index at its own generation while retaining flat storage filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "warlock-sitemap-generation-"));
    try {
      const index = new SitemapIndex({
        baseUrl: "https://shop.example",
        shardPathPrefix: "/sitemaps/generation-a/",
        maxUrlsPerFile: 1,
      });
      index.addSource(() => [{ path: "/products/a" }, { path: "/products/b" }]);
      const result = await index.saveTo(join(root, "output"));
      const xml = await readFile(result.indexPath, "utf8");

      expect(xml).toContain("https://shop.example/sitemaps/generation-a/sitemap-0001.xml");
      expect(xml).toContain("https://shop.example/sitemaps/generation-a/sitemap-0002.xml");
      expect(await readFile(result.files[0]!.path, "utf8")).toContain("/products/a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["../other", "//other", "generation/%2e%2e", "generation?x=1"])(
    "refuses unsafe shard URL prefixes: %s",
    (shardPathPrefix) => {
      expect(() => new SitemapIndex({ baseUrl: "https://shop.example", shardPathPrefix })).toThrow(
        "shardPathPrefix",
      );
    },
  );
});
