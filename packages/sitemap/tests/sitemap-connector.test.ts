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

vi.mock("@warlock.js/web/build", () => ({
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

  it("adds app-supplied entries to the page-derived ones", async () => {
    appConfig = { publicUrl: "https://example.test" };

    await sitemapConnector({
      entries: async () => [{ path: "/from-db/1" }],
    }).boot();

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

    expect(sentBody).toContain("<loc>https://example.test/</loc>");
    expect(sentBody).toContain("<loc>https://example.test/from-db/1</loc>");
  });

  it("lets an app-supplied entry win over a page-derived one at the same path", async () => {
    appConfig = { publicUrl: "https://example.test" };

    await sitemapConnector({
      entries: async () => [{ path: "/", priority: 0.9 }],
    }).boot();

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

    expect(sentBody).toMatch(/<loc>https:\/\/example\.test\/<\/loc>[\s\S]*<priority>0\.9<\/priority>/);
    expect(sentBody?.match(/<loc>https:\/\/example\.test\/<\/loc>/g)).toHaveLength(1);
  });
});
