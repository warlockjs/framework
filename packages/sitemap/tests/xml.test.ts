import { describe, expect, it } from "vitest";
import { buildSitemapXml, escapeXml } from "../src/xml";

describe("escapeXml", () => {
  it("escapes all five XML-significant characters", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes a URL with a query string containing &", () => {
    expect(escapeXml("/search?q=a&sort=asc")).toBe("/search?q=a&amp;sort=asc");
  });

  it("leaves ordinary characters untouched", () => {
    expect(escapeXml("/posts/hello-world")).toBe("/posts/hello-world");
  });
});

describe("buildSitemapXml", () => {
  it("emits the sitemaps.org urlset namespace", () => {
    const xml = buildSitemapXml([], "https://example.com");

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("starts with an XML declaration and closes the urlset", () => {
    const xml = buildSitemapXml([], "https://example.com");

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("orders elements loc, lastmod, changefreq, priority", () => {
    const xml = buildSitemapXml(
      [{ path: "/about", lastmod: "2026-09-17", changefreq: "weekly", priority: 0.5 }],
      "https://example.com",
    );

    const locIndex = xml.indexOf("<loc>");
    const lastmodIndex = xml.indexOf("<lastmod>");
    const changefreqIndex = xml.indexOf("<changefreq>");
    const priorityIndex = xml.indexOf("<priority>");

    expect(locIndex).toBeLessThan(lastmodIndex);
    expect(lastmodIndex).toBeLessThan(changefreqIndex);
    expect(changefreqIndex).toBeLessThan(priorityIndex);
  });

  it("omits optional elements that are absent from the entry", () => {
    const xml = buildSitemapXml([{ path: "/about" }], "https://example.com");

    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
  });

  it("escapes a & inside a URL's query string in the emitted <loc>", () => {
    const xml = buildSitemapXml([{ path: "/search?q=a&sort=asc" }], "https://example.com");

    expect(xml).toContain("<loc>https://example.com/search?q=a&amp;sort=asc</loc>");
    expect(xml).not.toContain("q=a&sort=asc<");
  });

  it("escapes the & in an alternate's href exactly as it escapes <loc>", () => {
    const xml = buildSitemapXml(
      [{ path: "/about", alternates: [{ hreflang: "en", path: "/about?ref=a&src=b" }] }],
      "https://example.com",
    );

    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://example.com/about?ref=a&amp;src=b"/>',
    );
    expect(xml).not.toContain("ref=a&src=b");
  });

  it("declares the xhtml namespace only when at least one entry has alternates", () => {
    const withAlternates = buildSitemapXml(
      [{ path: "/a", alternates: [{ hreflang: "en", path: "/a" }] }, { path: "/b" }],
      "https://example.com",
    );
    const withoutAlternates = buildSitemapXml(
      [{ path: "/a" }, { path: "/b" }],
      "https://example.com",
    );

    expect(withAlternates).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(withoutAlternates).not.toContain("xmlns:xhtml");
  });
});
