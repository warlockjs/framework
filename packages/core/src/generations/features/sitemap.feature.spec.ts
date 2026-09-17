import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configText = "";

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => true),
  getFileAsync: vi.fn(async () => configText),
  putFileAsync: vi.fn(async (_path: string, content: string) => {
    configText = content;
  }),
}));

import { sitemapFeature } from "./sitemap.feature";

const warlockConfigStub = ["export default defineConfig({", "  connectors: [],", "});", ""].join(
  "\n",
);

describe("add sitemap", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configText = warlockConfigStub;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("declares @warlock.js/sitemap as a dependency", () => {
    expect(Object.keys(sitemapFeature.dependencies ?? {})).toEqual(["@warlock.js/sitemap"]);
  });

  it("requires the web feature so `warlock add sitemap` installs web first", () => {
    expect(sitemapFeature.requires).toEqual(["web"]);
  });

  it("ejects src/config/sitemap.ts under the name `sitemap`", () => {
    expect(sitemapFeature.ejectConfig?.name).toBe("sitemap");
  });

  it("registers sitemapConnector() in warlock.config.ts", async () => {
    await sitemapFeature.onExecuting?.({} as never);

    expect(configText).toContain('import { sitemapConnector } from "@warlock.js/sitemap";');
    expect(configText).toContain("connectors: [sitemapConnector()],");
  });

  it("is idempotent on a second run", async () => {
    await sitemapFeature.onExecuting?.({} as never);
    const afterFirstRun = configText;

    await sitemapFeature.onExecuting?.({} as never);

    expect(configText).toBe(afterFirstRun);
  });

  it("reminds the developer to set the public origin", async () => {
    await sitemapFeature.onExecuting?.({} as never);

    expect(
      logSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes("app.publicUrl")),
    ).toBe(true);
  });
});
