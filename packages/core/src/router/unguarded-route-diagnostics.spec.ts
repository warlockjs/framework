import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./router";
import type { Middleware, RequestHandler, Route } from "./types";
import {
  isAuthGuardMiddleware,
  isUnguardedMutatingRoute,
  markAuthGuard,
  reportUnguardedMutatingRoutes,
  resetUnguardedRouteReports,
} from "./unguarded-route-diagnostics";

const handler = (): RequestHandler => (() => undefined) as unknown as RequestHandler;

const noop: Middleware = async () => undefined;

function registeredRoutes(): Route[] {
  return router.list() as Route[];
}

function resetRouter() {
  Reflect.set(router, "routes", []);
}

function routeAt(index: number): Route {
  const route = registeredRoutes()[index];
  if (!route) throw new Error(`No route at index ${index}`);
  return route;
}

describe("auth guard markers", () => {
  it("prefers an explicit marker over the function name", () => {
    const requireApiKey = markAuthGuard(async () => undefined);
    const authLookalike = markAuthGuard(async function authenticateMaybe() {
      return undefined;
    }, false);

    expect(isAuthGuardMiddleware(requireApiKey)).toBe(true);
    expect(isAuthGuardMiddleware(authLookalike)).toBe(false);
  });

  it("falls back to an auth/guard name and rejects non-functions", () => {
    expect(isAuthGuardMiddleware(async function adminGuard() {})).toBe(true);
    expect(isAuthGuardMiddleware(async function auth() {})).toBe(true);
    expect(isAuthGuardMiddleware(noop)).toBe(false);
    expect(isAuthGuardMiddleware(undefined)).toBe(false);
  });
});

describe("unguarded mutating routes", () => {
  beforeEach(() => {
    resetRouter();
    resetUnguardedRouteReports();
  });

  afterEach(() => {
    resetRouter();
  });

  it("flags POST/PUT/PATCH/DELETE without a guard or public: true", () => {
    router.post("/posts", handler());
    router.get("/posts", handler());
    router.post("/login", handler(), { public: true });
    router.put("/posts/:id", handler(), { middleware: [markAuthGuard(async () => undefined)] });
    router.post("/page-action", handler(), { isPage: true });
    router.delete("/posts/:id", handler(), { middleware: [noop] });

    expect(
      registeredRoutes()
        .filter(isUnguardedMutatingRoute)
        .map((route) => route.path),
    ).toEqual(["/posts", "/posts/:id"]);
  });

  it("inherits guards from groups and public from public groups", () => {
    const guard = markAuthGuard(async () => undefined);

    router.group({ middleware: [guard] }, () => {
      router.post("/guarded", handler());
    });
    router.group({ prefix: "/webhooks", public: true }, () => {
      router.post("/stripe", handler());
      router.post("/internal", handler(), { public: false });
    });
    router.post("/after", handler());

    expect(routeAt(0).public).toBeUndefined();
    expect(isUnguardedMutatingRoute(routeAt(0))).toBe(false);
    expect(routeAt(1).public).toBe(true);
    expect(routeAt(2).public).toBe(false);
    expect(routeAt(3).public).toBeUndefined();
    expect(
      registeredRoutes()
        .filter(isUnguardedMutatingRoute)
        .map((route) => route.path),
    ).toEqual(["/webhooks/internal", "/after"]);
  });

  it("reports a route with a group guard as guarded and one without as not", () => {
    const guard = markAuthGuard(async () => undefined);
    const optional = markAuthGuard(async () => undefined, false);

    router.group({ prefix: "/admin", middleware: [guard] }, () => {
      router.get("/stats", handler(), { name: "stats" });
    });
    router.group({ middleware: [optional] }, () => {
      router.get("/feed", handler(), { name: "feed" });
    });
    router.get("/open", handler(), { name: "open" });

    expect(router.getNamedApiRoutes()).toEqual([
      { name: "admin.stats", path: "/admin/stats", method: "GET", guarded: true },
      { name: "feed", path: "/feed", method: "GET" },
      { name: "open", path: "/open", method: "GET" },
    ]);
  });

  it("scopes routes to the sites of the group, and a route's own sites win", () => {
    router.group({ prefix: "/admin", sites: ["admin"] }, () => {
      router.get("/stats", handler(), { name: "stats" });
      router.get("/shared", handler(), { name: "shared", sites: ["admin", "shop"] });
      router.group({ prefix: "/inner", sites: ["ops"] }, () => {
        router.get("/x", handler(), { name: "x" });
      });
      router.get("/after", handler(), { name: "after" });
    });
    router.get("/open", handler(), { name: "open" });

    expect(router.getNamedApiRoutes().map((route) => [route.name, route.sites])).toEqual([
      ["admin.stats", ["admin"]],
      ["admin.shared", ["admin", "shop"]],
      ["admin.inner.x", ["ops"]],
      ["admin.after", ["admin"]],
      ["open", undefined],
    ]);
  });

  it("pops the public stack even when the group callback throws", () => {
    expect(() =>
      router.group({ public: true }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    router.post("/later", handler());
    expect(routeAt(0).public).toBeUndefined();
  });

  it("warns once per route, listing method, path and source file", () => {
    const warn = vi.fn();
    router.post("/posts", handler());
    router.patch("/posts/:id", handler());

    expect(reportUnguardedMutatingRoutes(registeredRoutes(), { warn })).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const entry = warn.mock.calls[0]?.[0] as { message: string; action: string };
    expect(entry.action).toBe("unguardedRoute");
    expect(entry.message).toContain("2 mutating routes have no auth middleware");
    expect(entry.message).toContain("POST /posts");
    expect(entry.message).toContain("PATCH /posts/:id");
    expect(entry.message).toContain("{ public: true }");

    // An HMR reload re-registers the same routes: no second warning.
    expect(reportUnguardedMutatingRoutes(registeredRoutes(), { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent when every mutating route is accounted for", () => {
    const warn = vi.fn();
    router.post("/login", handler(), { public: true });

    expect(reportUnguardedMutatingRoutes(registeredRoutes(), { warn })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
