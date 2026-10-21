import { describe, expect, it } from "vitest";
import {
  clientVisibleRouteNames,
  parseNamedApiRoutes,
  publishNamedApiRoutes,
  readNamedApiRoutes,
  resolveApiRoute,
} from "./named-api-routes";

describe("named API route registry", () => {
  it("accepts only name to path/method metadata and publishes it", () => {
    const routes = parseNamedApiRoutes({ "orders.get": { path: "/orders/:id", method: "GET" } });
    expect(routes).toEqual({ "orders.get": { path: "/orders/:id", method: "GET" } });
    publishNamedApiRoutes(routes);
    expect(readNamedApiRoutes()).toBe(routes);
  });

  it("refuses malformed route metadata without throwing", () => {
    expect(parseNamedApiRoutes({ orders: { path: "/orders" } })).toBeUndefined();
    expect(parseNamedApiRoutes([])).toBeUndefined();
  });

  it("resolves only own route names and preserves a literal prototype-shaped name", () => {
    publishNamedApiRoutes({});
    expect(() => resolveApiRoute("toString")).toThrow("not in this page's");
    const routes = parseNamedApiRoutes(
      JSON.parse('{"__proto__":{"path":"/safe","method":"POST"}}'),
    );
    publishNamedApiRoutes(routes);
    expect(resolveApiRoute("__proto__")).toEqual({ path: "/safe", method: "POST" });
    expect(Object.isFrozen(resolveApiRoute("__proto__"))).toBe(true);
  });
});

describe("resolveApiRoute outside the page's table", () => {
  it("names the route and says how to declare it", () => {
    publishNamedApiRoutes({});

    expect(() => resolveApiRoute("orders.purge")).toThrow(
      /Named API route "orders\.purge" is not in this page's/,
    );
    expect(() => resolveApiRoute("orders.purge")).toThrow(/config\.apiRoutes/);
  });
});

describe("clientVisibleRouteNames", () => {
  it("keeps every route except the ones that opted out of the browser", () => {
    const routes = [
      { name: "orders.show", path: "/orders/:id", method: "GET" as const },
      {
        name: "internal.reindex",
        path: "/internal/reindex",
        method: "POST" as const,
        clientVisible: false as const,
      },
      { name: "orders.create", path: "/orders", method: "POST" as const },
    ];

    expect(clientVisibleRouteNames(routes)).toEqual(["orders.show", "orders.create"]);
  });
});
