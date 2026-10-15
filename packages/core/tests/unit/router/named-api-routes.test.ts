import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import type { RequestHandler } from "../../../src/router/types";

const router = Router.getInstance();
const noop: RequestHandler = () => undefined as any;
let sourceFile = "";
let counter = 0;

function withScope(callback: () => void) {
  return router.withSourceFile(sourceFile, callback);
}

beforeEach(() => {
  sourceFile = `named-api-routes-${counter++}`;
  return () => router.removeRoutesBySourceFile(sourceFile);
});

describe("Router.getNamedApiRoutes", () => {
  it("returns only named non-page metadata with no server registration details", async () => {
    await withScope(() => {
      router.post("/api/users/:id", noop, { name: "users.update", label: "Update user" });
      router.get("/users/:id", noop, { name: "users.page", isPage: true });
      router.get("/unnamed", noop, { name: "" });
    });

    expect(router.getNamedApiRoutes().filter((route) => route.path.startsWith("/api/"))).toEqual([
      { name: "users.update", path: "/api/users/:id", method: "POST" },
    ]);
    expect(Object.keys(router.getNamedApiRoutes().find((route) => route.name === "users.update")!)).toEqual([
      "name", "path", "method",
    ]);
  });

  it("preserves the registered suffix for same-name routes with different methods and keeps all", async () => {
    await withScope(() => {
      router.get("/api/things", noop, { name: "things" });
      router.post("/api/things", noop, { name: "things" });
      router.any("/api/health", noop, { name: "health" });
    });

    const routes = router.getNamedApiRoutes().filter((route) => route.path.startsWith("/api/"));

    expect(routes).toEqual([
      { name: "things", path: "/api/things", method: "GET" },
      { name: "things.post", path: "/api/things", method: "POST" },
      { name: "health", path: "/api/health", method: "all" },
    ]);
  });

  it("returns frozen copies so consumer mutation cannot alter the router", async () => {
    await withScope(() => {
      router.post("/api/orders", noop, { name: "orders.create" });
    });

    const first = router.getNamedApiRoutes();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => {
      (first[0] as { path: string }).path = "/changed";
    }).toThrow();

    expect(router.getNamedApiRoutes().find((route) => route.name === "orders.create")).toEqual({
      name: "orders.create",
      path: "/api/orders",
      method: "POST",
    });
    expect(router.getNamedApiRoutes()).not.toBe(first);
  });
});
