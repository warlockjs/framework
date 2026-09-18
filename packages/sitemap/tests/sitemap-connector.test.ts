import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@warlock.js/web", () => ({
  listRoutablePages: async () => [
    { routeName: "home", routePath: "/", metadata: undefined, sitemap: undefined },
  ],
}));

import { MissingPublicUrlError } from "../src/url";
import { sitemapConnector } from "../src/sitemap-connector";

describe("sitemapConnector", () => {
  beforeEach(() => {
    appConfig = undefined;
    sitemapConfig = { enabled: true };
    registeredRoutes = [];
  });

  afterEach(() => {
    delete process.env.PUBLIC_APP_URL;
  });

  it("registers nothing when the sitemap config is not enabled", async () => {
    sitemapConfig = { enabled: false };

    await sitemapConnector().boot();

    expect(registeredRoutes).toHaveLength(0);
  });

  it("refuses to boot when enabled with no public origin configured", async () => {
    await expect(sitemapConnector().boot()).rejects.toThrow(MissingPublicUrlError);
    expect(registeredRoutes).toHaveLength(0);
  });

  it("registers GET <config.path> and serves application/xml once an origin is set", async () => {
    appConfig = { publicUrl: "https://example.test" };

    await sitemapConnector().boot();

    expect(registeredRoutes).toHaveLength(1);

    const route = registeredRoutes[0];

    if (route === undefined) throw new Error("expected the connector to register a route");

    expect(route.path).toBe("/sitemap.xml");

    let sentContentType: string | undefined;
    let sentBody: string | undefined;
    const response = {
      setContentType(value: string) {
        sentContentType = value;
        return this;
      },
      async send(body: string) {
        sentBody = body;
        return this;
      },
    };

    await route.handler({ response });

    expect(sentContentType).toBe("application/xml");
    expect(sentBody).toContain("<loc>https://example.test/</loc>");
  });
});
