import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "@warlock.js/core";

const { compileCalls } = vi.hoisted(() => ({ compileCalls: { count: 0 } }));

vi.mock("../client/runtime/matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client/runtime/matcher")>();

  return {
    ...actual,
    createClientRouteMatcher: (...args: Parameters<typeof actual.createClientRouteMatcher>) => {
      compileCalls.count++;
      return actual.createClientRouteMatcher(...args);
    },
  };
});

import { connectCurrentSite } from "../routing/site-url";
import { createSiteDispatch, SITE_DISPATCH_ROUTE_PATH } from "./site-dispatch";
import type { PageRouteHandler } from "./create-page-route-handler";

afterEach(() => {
  connectCurrentSite(undefined);
});

function capture() {
  const handlers = new Map<string, PageRouteHandler>();
  const router = {
    list: () => [],
    get: (path: string, handler: PageRouteHandler) => handlers.set(`GET ${path}`, handler),
    post: (path: string, handler: PageRouteHandler) => handlers.set(`POST ${path}`, handler),
  } as unknown as Router;

  return { router, handlers };
}

function context(path: string) {
  const params: Record<string, string> = {};

  return {
    request: {
      path,
      method: "GET",
      protocol: "https",
      params,
      setParam: (key: string, value: string) => {
        params[key] = value;
      },
      header: (name: string) => (name === "host" ? "a.test" : undefined),
      baseRequest: { hostname: "a.test" },
    },
    response: { send: vi.fn() },
  };
}

describe("multi-site dispatch route table", () => {
  it("compiles a site's routes once, not on every request, with the same matches", async () => {
    const dispatch = createSiteDispatch({ sites: { a: { hosts: ["a.test"] } } });
    const served: string[] = [];
    const page =
      (name: string): PageRouteHandler =>
      async ({ request }) => {
        served.push(`${name} ${JSON.stringify(request.params)}`);
      };

    dispatch.add("a", "GET", "/", page("home"));
    dispatch.add("a", "GET", "/products/:id", page("product"));

    const { router, handlers } = capture();
    dispatch.register(router);
    const handler = handlers.get(`GET ${SITE_DISPATCH_ROUTE_PATH}`)!;

    compileCalls.count = 0;
    await handler(context("/products/7") as never);
    await handler(context("/") as never);
    await handler(context("/products/8") as never);

    expect(compileCalls.count).toBe(1);
    expect(served).toEqual(['product {"id":"7"}', "home {}", 'product {"id":"8"}']);
  });

  it("recompiles after a page is added to the table", async () => {
    const dispatch = createSiteDispatch({ sites: { a: { hosts: ["a.test"] } } });
    const served: string[] = [];

    dispatch.add("a", "GET", "/", async () => {
      served.push("home");
    });

    const { router, handlers } = capture();
    dispatch.register(router);
    const handler = handlers.get(`GET ${SITE_DISPATCH_ROUTE_PATH}`)!;

    await handler(context("/") as never);
    dispatch.add("a", "GET", "/about", async () => {
      served.push("about");
    });
    await handler(context("/about") as never);

    expect(served).toEqual(["home", "about"]);
  });
});
