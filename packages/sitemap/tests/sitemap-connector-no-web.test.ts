import { beforeEach, describe, expect, it, vi } from "vitest";

let appConfig: { publicUrl?: string } | undefined;
let sitemapConfig: { enabled: boolean; path?: string } | undefined;
let registeredRoutes: Array<{ path: string; handler: (...args: any[]) => any }> = [];

vi.mock("@warlock.js/core", () => ({
  config: {
    get: (name: string) => (name === "app" ? appConfig : sitemapConfig),
  },
  router: {
    get: (path: string, handler: (...args: any[]) => any) => {
      registeredRoutes.push({ path, handler });
    },
  },
}));

// Simulates a Warlock API-only project: `@warlock.js/web` is not installed,
// so importing it fails the way it would in node's module resolution.
vi.mock("@warlock.js/web/build", () => {
  throw new Error("Cannot find package '@warlock.js/web/build'");
});

import { NoPageRegistryError, sitemapConnector } from "../src/sitemap-connector";

describe("sitemapConnector — @warlock.js/web not installed", () => {
  beforeEach(() => {
    appConfig = { publicUrl: "https://example.test" };
    sitemapConfig = { enabled: true };
    registeredRoutes = [];
  });

  it("refuses to boot with no page registry and no entries supplier", async () => {
    await expect(sitemapConnector().boot()).rejects.toThrow(NoPageRegistryError);
    await expect(sitemapConnector().boot()).rejects.toThrow(
      /no `entries` option was supplied/,
    );
    expect(registeredRoutes).toHaveLength(0);
  });

  it("boots and serves app-supplied entries when entries is given, API-only style", async () => {
    await sitemapConnector({
      entries: async () => [{ path: "/api/status" }],
    }).boot();

    expect(registeredRoutes).toHaveLength(1);

    const route = registeredRoutes[0];

    if (route === undefined) throw new Error("expected the connector to register a route");

    let sentBody: string | undefined;
    const response = {
      setContentType() {
        return this;
      },
      async send(body: string) {
        sentBody = body;
        return this;
      },
    };

    await route.handler({ response });

    expect(sentBody).toContain("<loc>https://example.test/api/status</loc>");
  });
});
