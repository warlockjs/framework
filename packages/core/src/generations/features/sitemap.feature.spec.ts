import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configText: string | undefined;
let fileExists = true;

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => fileExists),
  getFileAsync: vi.fn(async () => configText ?? ""),
  putFileAsync: vi.fn(async (_path: string, content: string) => {
    configText = content;
  }),
}));

import { sitemapFeature } from "./sitemap.feature";

/**
 * Extract the `{`…`}` body of a `key: {` block from generated source, by
 * brace counting rather than a pinned literal — so these assertions survive
 * unrelated formatting/comment changes to the stub.
 */
function extractObjectBlock(source: string, key: string): string {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(source);

  if (!match) {
    throw new Error(`No \`${key}: {\` block found in:\n${source}`);
  }

  let depth = 1;
  let index = match.index + match[0].length;
  const start = index;

  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  return source.slice(start, index);
}

describe("add sitemap", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configText = undefined;
    fileExists = true;
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("declares @warlock.js/sitemap as a dependency", () => {
    expect(Object.keys(sitemapFeature.dependencies ?? {})).toEqual(["@warlock.js/sitemap"]);
  });

  it("requires the web feature so `warlock add sitemap` installs web first", () => {
    expect(sitemapFeature.requires).toEqual(["web"]);
  });

  it("never scaffolds the deleted src/config/sitemap.ts shape", () => {
    expect(sitemapFeature.ejectConfig).toBeUndefined();
  });

  describe("fresh app (no src/config/web.ts yet)", () => {
    beforeEach(() => {
      fileExists = false;
    });

    it("creates src/config/web.ts with a disabled sitemap section, keyed under `sitemap`", async () => {
      await sitemapFeature.onExecuting?.({} as never);

      expect(configText).toBeDefined();
      const written = configText as string;

      // The deleted 5.15 shape must never reappear.
      expect(written).not.toMatch(/\bSitemapConfig\b/);
      expect(written).not.toContain("sitemapConnector");
      expect(written).not.toContain("src/config/sitemap.ts");

      const sitemapBlock = extractObjectBlock(written, "sitemap");
      expect(sitemapBlock).toMatch(/enabled\s*:\s*false/);
      expect(sitemapBlock).toMatch(/path\s*:\s*"\/sitemap\.xml"/);

      const defaultsBlock = extractObjectBlock(sitemapBlock, "defaults");
      expect(defaultsBlock).toMatch(/changefreq\s*:\s*"weekly"/);
      expect(defaultsBlock).toMatch(/priority\s*:\s*0\.5/);

      // No baseUrl key: origin comes from app.publicUrl alone.
      expect(sitemapBlock).not.toMatch(/baseUrl/);
    });
  });

  describe("existing src/config/web.ts without a sitemap section", () => {
    beforeEach(() => {
      configText = [
        "import type { WebConfigurations } from '@warlock.js/web';",
        "",
        "const webConfig: WebConfigurations = {",
        "  streaming: { deferTimeout: 5000 },",
        "};",
        "",
        "export default webConfig;",
        "",
      ].join("\n");
    });

    it("merges in a disabled sitemap section while preserving the existing streaming key", async () => {
      await sitemapFeature.onExecuting?.({} as never);

      const written = configText as string;

      const streamingBlock = extractObjectBlock(written, "streaming");
      expect(streamingBlock).toMatch(/deferTimeout\s*:\s*5000/);

      const sitemapBlock = extractObjectBlock(written, "sitemap");
      expect(sitemapBlock).toMatch(/enabled\s*:\s*false/);
    });
  });

  describe("existing src/config/web.ts with a sitemap section already", () => {
    beforeEach(() => {
      configText = [
        "const webConfig = {",
        "  sitemap: { enabled: true, path: '/custom-sitemap.xml' },",
        "};",
        "",
        "export default webConfig;",
        "",
      ].join("\n");
    });

    it("is idempotent: leaves an existing sitemap section untouched", async () => {
      const before = configText;

      await sitemapFeature.onExecuting?.({} as never);

      expect(configText).toBe(before);
      expect((configText as string).match(/\bsitemap\s*:/g)).toHaveLength(1);
    });
  });

  describe("existing src/config/web.ts that cannot be safely merged", () => {
    beforeEach(() => {
      configText = [
        "import { defineWebConfig } from '@warlock.js/web';",
        "",
        "export default defineWebConfig({",
        "  streaming: { deferTimeout: 5000 },",
        "});",
        "",
      ].join("\n");
    });

    it("refuses without clobbering the file, and names it in the message", async () => {
      const before = configText;

      await sitemapFeature.onExecuting?.({} as never);

      expect(configText).toBe(before);
      expect(process.exitCode).toBe(1);
      expect(
        logSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes("src/config/web.ts")),
      ).toBe(true);
    });
  });
});
