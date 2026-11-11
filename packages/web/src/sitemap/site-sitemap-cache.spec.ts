import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Response, type HttpContext, type Router } from "@warlock.js/core";
import { registerSitemapRoutes } from "./register-sitemap-routes";
import type { SitemapPageSource } from "./sitemap-page-source";
import type { SitemapSupplierContext } from "./sitemap-page-export";

/**
 * Multi-site `/sitemap.xml` is built in memory per site. It must be reused
 * across requests (with validators) instead of running every page's sitemap
 * supplier each time, and a dynamic tenant's suppliers must learn which
 * tenant they are building for.
 */

function capturingRouter() {
  const routes = new Map<string, (context: HttpContext) => unknown>();
  const router = {
    get: vi.fn((routePath: string, handler: (context: HttpContext) => unknown) => {
      routes.set(routePath, handler);
    }),
    head: vi.fn(),
  } as unknown as Router;

  return { router, routes };
}

function realResponse() {
  const headers: Record<string, string> = {};
  let sentBody: unknown;
  let status = 200;
  const response = new Response();

  response.setResponse({
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    status: (code: number) => {
      status = code;
      return response.baseResponse;
    },
    code: (code: number) => {
      status = code;
      return response.baseResponse;
    },
    send: (body: unknown) => {
      sentBody = body;
    },
    sent: false,
    raw: { once: () => {} },
  } as never);

  return { response, headers, getBody: () => sentBody, getStatus: () => status };
}

function requestFor(host: string, headers: Record<string, string> = {}) {
  return {
    protocol: "https",
    path: "/sitemap.xml",
    method: "GET",
    params: {},
    header: (name: string) => (name === "host" ? host : (headers[name] ?? null)),
    baseRequest: { hostname: host },
  };
}

afterEach(() => {
  config.set("app", {});
  config.set("web", {});
});

function register(pageSource: SitemapPageSource) {
  const { router, routes } = capturingRouter();

  registerSitemapRoutes(router, {
    path: "/sitemap.xml",
    warn: () => undefined,
    getServingState: () => undefined,
    pageSource,
  });

  return routes.get("/sitemap.xml")!;
}

describe("multi-site sitemap reuse", () => {
  it("runs a page's sitemap supplier once for two consecutive requests", async () => {
    config.set("web", {
      sites: { landing: { hosts: ["landing.test"] } },
      sitemap: { enabled: true, path: "/sitemap.xml" },
    });
    const supplier = vi.fn(() => [{ path: "/posts/one" }]);
    const handler = register(() => [
      { routeName: "post", routePath: "/posts/:slug", site: "landing", sitemap: supplier },
    ]);

    const first = realResponse();
    await handler({ request: requestFor("landing.test"), response: first.response } as never);
    const second = realResponse();
    await handler({ request: requestFor("landing.test"), response: second.response } as never);

    expect(supplier).toHaveBeenCalledTimes(1);
    expect(String(second.getBody())).toBe(String(first.getBody()));
    expect(String(first.getBody())).toContain("https://landing.test/posts/one");
    expect(first.headers.ETag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.headers["Cache-Control"]).toBe("public, max-age=300");
  });

  it("runs the suppliers once for a fallback site requested under many hosts", async () => {
    config.set("web", {
      sites: { main: { hosts: ["main.test"] } },
      unknownHost: "main",
      sitemap: { enabled: true, path: "/sitemap.xml" },
    });
    const supplier = vi.fn(() => [{ path: "/posts/one" }]);
    const handler = register(() => [
      { routeName: "post", routePath: "/posts/:slug", site: "main", sitemap: supplier },
    ]);

    for (const host of ["random-1.test", "random-2.test", "random-3.test"]) {
      const { response, getBody } = realResponse();
      await handler({ request: requestFor(host), response } as never);
      expect(String(getBody())).toContain(`https://${host}/posts/one`);
    }

    expect(supplier).toHaveBeenCalledTimes(1);
  });

  it("answers If-None-Match with the returned ETag with a 304", async () => {
    config.set("web", {
      sites: { landing: { hosts: ["landing.test"] } },
      sitemap: { enabled: true, path: "/sitemap.xml" },
    });
    const handler = register(() => [{ routeName: "home", routePath: "/", site: "landing" }]);

    const first = realResponse();
    await handler({ request: requestFor("landing.test"), response: first.response } as never);
    const revalidated = realResponse();
    await handler({
      request: requestFor("landing.test", { "if-none-match": first.headers.ETag! }),
      response: revalidated.response,
    } as never);

    expect(revalidated.getStatus()).toBe(304);
    expect(revalidated.getBody()).toBeUndefined();
  });
});

describe("dynamic site sitemap suppliers", () => {
  it("hand each indexable tenant's supplier its own tenantKey", async () => {
    const resolveHost = ({ host }: { host: string }) => ({
      site: "tenant",
      key: host === "a.example" ? "tenant-a" : "tenant-b",
      indexable: true,
    });
    config.set("web", {
      sites: { tenant: { dynamic: true } },
      resolveHost,
      sitemap: { enabled: true, path: "/sitemap.xml" },
    });
    const contexts: SitemapSupplierContext[] = [];
    const supplier = vi.fn((context: SitemapSupplierContext) => {
      contexts.push(context);
      return [{ path: `/listings/${context.tenantKey}` }];
    });
    const handler = register(() => [
      { routeName: "listing", routePath: "/listings/:id", site: "tenant", sitemap: supplier },
    ]);

    const tenantA = realResponse();
    await handler({ request: requestFor("a.example"), response: tenantA.response } as never);
    const tenantB = realResponse();
    await handler({ request: requestFor("b.example"), response: tenantB.response } as never);

    expect(contexts.map((context) => context.tenantKey)).toEqual(["tenant-a", "tenant-b"]);
    expect(contexts[0]?.site).toBe("tenant");
    expect(String(tenantA.getBody())).toContain("https://a.example/listings/tenant-a");
    expect(String(tenantA.getBody())).not.toContain("tenant-b");
    expect(String(tenantB.getBody())).toContain("https://b.example/listings/tenant-b");
  });
});
