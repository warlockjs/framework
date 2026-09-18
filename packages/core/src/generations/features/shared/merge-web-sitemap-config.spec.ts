import { describe, expect, it } from "vitest";
import { mergeWebSitemapConfig } from "./merge-web-sitemap-config";

describe("mergeWebSitemapConfig", () => {
  it("merges a sitemap block into a named-const export with an existing key", () => {
    const source = [
      "const webConfig: WebConfigurations = {",
      "  streaming: { deferTimeout: 5000 },",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    expect(result.next).toContain("streaming: { deferTimeout: 5000 },");
    expect(result.next).toMatch(/sitemap:\s*\{/);
    expect(result.next).toContain("enabled: false,");
  });

  it("merges into an empty named-const export", () => {
    const source = ["const webConfig = {", "};", "", "export default webConfig;", ""].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
  });

  it("merges into an inline `export default {}`", () => {
    const source = ["export default {", "  streaming: {},", "};", ""].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    expect(result.next).toContain("streaming: {},");
    expect(result.next).toMatch(/sitemap:\s*\{/);
  });

  it("adds a missing trailing comma before inserting", () => {
    const source = [
      "const webConfig = {",
      "  streaming: { deferTimeout: 5000 }",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    expect(result.next).toContain("streaming: { deferTimeout: 5000 },");
  });

  it("is a no-op when a sitemap key already exists", () => {
    const source = [
      "const webConfig = {",
      "  sitemap: { enabled: true },",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    expect(mergeWebSitemapConfig(source)).toEqual({ status: "already-present" });
  });

  it("refuses a default export that is neither inline nor a plain const", () => {
    const source = [
      "export default defineWebConfig({",
      "  streaming: { deferTimeout: 5000 },",
      "});",
      "",
    ].join("\n");

    expect(mergeWebSitemapConfig(source)).toEqual({ status: "unrecognised" });
  });

  it("refuses a file with no default export at all", () => {
    const source = "export const webConfig = { streaming: {} };\n";

    expect(mergeWebSitemapConfig(source)).toEqual({ status: "unrecognised" });
  });

  it("merges when `sitemap` only appears inside a comment", () => {
    const source = [
      "const webConfig = {",
      "  // sitemap: TODO figure out defaults",
      "  streaming: { deferTimeout: 5000 },",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    expect(result.next).toMatch(/\n\s*sitemap:\s*\{/);
  });

  it("does not corrupt the file when a string value contains braces", () => {
    const source = [
      "const webConfig = {",
      '  streaming: { note: "use `{}` for interpolation, e.g. {foo}" },',
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    if (result.status === "merged") {
      expect(() => new Function(result.next.replace(/^export default/m, "return"))).not.toThrow();
      expect(result.next).toContain('note: "use `{}` for interpolation, e.g. {foo}"');
      expect(result.next).toMatch(/\n\s*sitemap:\s*\{/);
    } else {
      expect(result.status).toBe("unrecognised");
    }
  });

  it("refuses rather than write a syntactically broken merge", () => {
    // `lastPropertyEnd` is a plain character scan, unaware that `/* ... */`
    // is a comment: it treats the comment's closing `*/` as "the last
    // property", so it appends a comma right after it — a naked comma with
    // nothing between it and `sitemap:` is not valid inside an object
    // literal. The post-merge parse check must catch this and refuse.
    const source = [
      "const webConfig = {",
      "  streaming: {},",
      "  /* keep this until sitemap ships */",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    expect(mergeWebSitemapConfig(source)).toEqual({ status: "unrecognised" });
  });

  it("does not corrupt the file when a value is a template literal containing braces", () => {
    const source = [
      "const webConfig = {",
      '  streaming: { note: `use ${"{"} for interpolation } end` },',
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    if (result.status === "merged") {
      const propertyCount = (result.next.match(/\bsitemap:\s*\{/g) ?? []).length;

      expect(propertyCount).toBe(1);
      expect(result.next).toContain('note: `use ${"{"} for interpolation } end`');
    } else {
      expect(result.status).toBe("unrecognised");
    }
  });

  it("does not corrupt the file when a value is a regex literal containing braces", () => {
    const source = [
      "const webConfig = {",
      "  streaming: { pattern: /[{}]/g },",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    if (result.status === "merged") {
      const propertyCount = (result.next.match(/\bsitemap:\s*\{/g) ?? []).length;

      expect(propertyCount).toBe(1);
      expect(result.next).toContain("pattern: /[{}]/g");
    } else {
      expect(result.status).toBe("unrecognised");
    }
  });

  it("merges past a value with a deeply nested object", () => {
    const source = [
      "const webConfig = {",
      '  robots: { rules: [{ userAgent: "*" }] },',
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    const propertyCount = (result.next.match(/\bsitemap:\s*\{/g) ?? []).length;

    expect(propertyCount).toBe(1);
    expect(result.next).toContain('robots: { rules: [{ userAgent: "*" }] },');
  });

  it("merges when the word `sitemap` appears outside the exported object", () => {
    const source = [
      "const sitemap = 1;",
      'const note = "sitemap:";',
      "",
      "const webConfig = {",
      "  streaming: {},",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    expect(result.next).toContain("const sitemap = 1;");
    expect(result.next).toContain('const note = "sitemap:";');
    expect(result.next).toMatch(/\n\s*sitemap:\s*\{/);
  });

  it("merges past an existing `sitemap` key nested under another property", () => {
    const source = [
      "const webConfig = {",
      "  seo: { sitemap: true },",
      "};",
      "",
      "export default webConfig;",
      "",
    ].join("\n");

    const result = mergeWebSitemapConfig(source);

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;

    const insertedBlockCount = (result.next.match(/\n\s*sitemap:\s*\{\n\s*enabled: false,/g) ?? [])
      .length;

    expect(result.next).toContain("seo: { sitemap: true },");
    expect(insertedBlockCount).toBe(1);
  });
});
