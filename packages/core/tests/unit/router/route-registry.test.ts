import { describe, expect, it } from "vitest";
import { RouteRegistry } from "../../../src/router/route-registry";
import type { RequestHandler, RequestMethod, Route } from "../../../src/router/types";

const noop: RequestHandler = () => undefined as any;

/**
 * Build a minimal but type-complete `Route`. The registry only reads `method`
 * and `path`, but the array signature wants the full shape.
 */
function route(method: RequestMethod, path: string, name = path): Route {
  return {
    method,
    path,
    name,
    handler: noop,
    sourceFile: "",
    $prefix: "/",
    $prefixStack: [],
  };
}

describe("RouteRegistry — matching", () => {
  it("matches a static path and returns the route", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users")]);

    const match = registry.find("GET", "/users");

    expect(match?.route.path).toBe("/users");
    expect(match?.params).toEqual({});
  });

  it("extracts named params from a dynamic segment", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users/:id")]);

    const match = registry.find("GET", "/users/123");

    expect(match?.params).toEqual({ id: "123" });
  });

  it("extracts multiple params", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users/:userId/posts/:postId")]);

    const match = registry.find("GET", "/users/7/posts/99");

    expect(match?.params).toEqual({ userId: "7", postId: "99" });
  });

  it("returns null when no route matches", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users")]);

    expect(registry.find("GET", "/unknown")).toBeNull();
  });

  it("returns null when the path matches but the method does not", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users")]);

    expect(registry.find("POST", "/users")).toBeNull();
  });

  it("strips the query string before matching", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/search")]);

    const match = registry.find("GET", "/search?q=hello&page=2");

    expect(match?.route.path).toBe("/search");
  });

  it("ignores a trailing slash", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users")]);

    expect(registry.find("GET", "/users/")?.route.path).toBe("/users");
  });

  it("matches the path case-insensitively (caseSensitive: false)", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/Users")]);

    expect(registry.find("GET", "/users")?.route.path).toBe("/Users");
  });

  it("does NOT normalize the HTTP method — find-my-way expects it uppercased", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users")]);

    // The router always forwards `fastifyRequest.method` (already uppercase),
    // so a lowercase method here is never produced in practice and does not match.
    expect(registry.find("get", "/users")).toBeNull();
  });
});

describe("RouteRegistry — `all` method expansion", () => {
  it("registers an `all` route under both GET and POST", () => {
    const registry = new RouteRegistry();
    registry.register([route("all", "/any")]);

    expect(registry.find("GET", "/any")?.route.path).toBe("/any");
    expect(registry.find("POST", "/any")?.route.path).toBe("/any");
  });

  it("registers `all` routes under PUT, DELETE and PATCH (full verb parity with Fastify)", () => {
    const registry = new RouteRegistry();
    registry.register([route("all", "/any")]);

    expect(registry.find("PUT", "/any")?.route.path).toBe("/any");
    expect(registry.find("DELETE", "/any")?.route.path).toBe("/any");
    expect(registry.find("PATCH", "/any")?.route.path).toBe("/any");
  });

  it("registers `all` routes under OPTIONS and HEAD too", () => {
    const registry = new RouteRegistry();
    registry.register([route("all", "/any")]);

    expect(registry.find("OPTIONS", "/any")?.route.path).toBe("/any");
    expect(registry.find("HEAD", "/any")?.route.path).toBe("/any");
  });
});

describe("RouteRegistry — priority", () => {
  it("prefers a static segment over a dynamic one", () => {
    const registry = new RouteRegistry();
    registry.register([route("GET", "/users/:id", "byId"), route("GET", "/users/me", "me")]);

    expect(registry.find("GET", "/users/me")?.route.name).toBe("me");
    expect(registry.find("GET", "/users/42")?.route.name).toBe("byId");
  });
});
