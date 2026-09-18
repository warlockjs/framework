import { describe, expect, it } from "vitest";
import { sitemapFeature } from "./sitemap.feature";

describe("warlock add sitemap config stub", () => {
  it("pins the generated src/config/sitemap.ts literal", () => {
    const content = sitemapFeature.ejectConfig?.content ?? "";

    expect(content).toContain('import type { SitemapConfig } from "@warlock.js/sitemap";');
    expect(content).toContain("const sitemapConfig: SitemapConfig = {");
    // Ships DISABLED on purpose: a generated app cannot know its own public
    // origin, and an enabled sitemap without one REFUSES to boot. Generating
    // "enabled: true" broke "warlock add sitemap" in the generator matrix —
    // the app crashed four times in 60s and gave up before serving anything.
    expect(content).toContain("enabled: false,");
    expect(content).toContain("app.publicUrl");
    expect(content).toContain('path: "/sitemap.xml",');
    expect(content).toContain("defaults: { changefreq: \"weekly\", priority: 0.5 },");
    expect(content).toContain("export default sitemapConfig;");
  });
});
