import { describe, expect, it } from "vitest";
import { sitemapFeature } from "./sitemap.feature";

describe("warlock add sitemap config stub", () => {
  it("pins the generated src/config/sitemap.ts literal", () => {
    const content = sitemapFeature.ejectConfig?.content ?? "";

    expect(content).toContain('import type { SitemapConfig } from "@warlock.js/sitemap";');
    expect(content).toContain("const sitemapConfig: SitemapConfig = {");
    expect(content).toContain("enabled: true,");
    expect(content).toContain('path: "/sitemap.xml",');
    expect(content).toContain("defaults: { changefreq: \"weekly\", priority: 0.5 },");
    expect(content).toContain("export default sitemapConfig;");
  });
});
