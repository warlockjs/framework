import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import type { Middleware, Route } from "../../../src/router/types";

const router = Router.getInstance();

let sourceFile = "";
let counter = 0;

function withScope(callback: () => void) {
  return router.withSourceFile(sourceFile, callback);
}

function scopedRoutes(): Route[] {
  return router.list().filter((route) => route.sourceFile === sourceFile);
}

beforeEach(() => {
  sourceFile = `group-source-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("Router — prefix groups", () => {
  it("prepends the group prefix to the route path", async () => {
    await withScope(() => {
      router.prefix("/admin", () => {
        router.get("/users", () => undefined as any);
      });
    });

    const [route] = scopedRoutes();

    expect(route.path).toBe("/admin/users");
    expect(route.$prefix).toBe("/admin");
    expect(route.$prefixStack).toEqual(["/admin"]);
  });

  it("derives a dotted name combining the prefix and the path", async () => {
    await withScope(() => {
      router.prefix("/admin", () => {
        router.get("/users", () => undefined as any);
      });
    });

    expect(scopedRoutes()[0].name).toBe("admin.users");
  });

  it("nests prefixes from outer to inner", async () => {
    await withScope(() => {
      router.prefix("/api", () => {
        router.prefix("/v1", () => {
          router.get("/posts", () => undefined as any);
        });
      });
    });

    const [route] = scopedRoutes();

    expect(route.path).toBe("/api/v1/posts");
    expect(route.$prefixStack).toEqual(["/api", "/v1"]);
  });

  it("pops the prefix stack after the group callback so siblings are unaffected", async () => {
    await withScope(() => {
      router.prefix("/admin", () => {
        router.get("/inside", () => undefined as any);
      });

      router.get("/outside", () => undefined as any);
    });

    const paths = scopedRoutes().map((route) => route.path);

    expect(paths).toEqual(["/admin/inside", "/outside"]);
  });

  it("formats a version group as /v{version}", async () => {
    await withScope(() => {
      router.version("2", () => {
        router.get("/users", () => undefined as any);
      });
    });

    expect(scopedRoutes()[0].path).toBe("/v2/users");
  });

  it("accepts a numeric version", async () => {
    await withScope(() => {
      router.version(3, () => {
        router.get("/items", () => undefined as any);
      });
    });

    expect(scopedRoutes()[0].path).toBe("/v3/items");
  });
});

describe("Router — group options", () => {
  it("applies an explicit group name prefix to nested route names", async () => {
    await withScope(() => {
      router.group({ prefix: "/shop", name: "store" }, () => {
        router.get("/products", () => undefined as any);
      });
    });

    expect(scopedRoutes()[0].name).toBe("store.products");
  });

  it("prepends group middleware ahead of route-level middleware (default precedence)", async () => {
    const groupMiddleware: Middleware = function groupGuard() {
      return undefined;
    };

    const routeMiddleware: Middleware = function routeGuard() {
      return undefined;
    };

    await withScope(() => {
      router.group({ prefix: "/secured", middleware: [groupMiddleware] }, () => {
        router.get("/dashboard", () => undefined as any, {
          middleware: [routeMiddleware],
        });
      });
    });

    expect(scopedRoutes()[0].middleware).toEqual([groupMiddleware, routeMiddleware]);
  });

  it("appends group middleware after route middleware when precedence is 'before'", async () => {
    const groupMiddleware: Middleware = function groupGuard() {
      return undefined;
    };

    const routeMiddleware: Middleware = function routeGuard() {
      return undefined;
    };

    await withScope(() => {
      router.group({ prefix: "/secured", middleware: [groupMiddleware] }, () => {
        router.get("/dashboard", () => undefined as any, {
          middleware: [routeMiddleware],
          middlewarePrecedence: "before",
        });
      });
    });

    expect(scopedRoutes()[0].middleware).toEqual([routeMiddleware, groupMiddleware]);
  });

  it("cleans up the prefix/name/middleware stacks when the group callback throws", async () => {
    const groupMiddleware: Middleware = function groupGuard() {
      return undefined;
    };

    await withScope(() => {
      expect(() => {
        router.group({ prefix: "/boom", name: "boom", middleware: [groupMiddleware] }, () => {
          throw new Error("callback exploded");
        });
      }).toThrow("callback exploded");

      // A route registered outside the failed group must see clean stacks:
      // no leaked prefix, name or middleware from the throwing group.
      router.get("/outside", () => undefined as any);
    });

    const outside = scopedRoutes().find((route) => route.path === "/outside");

    expect(outside?.path).toBe("/outside");
    expect(outside?.name).toBe("outside");
    expect(outside?.$prefixStack).toEqual([]);
    expect(outside?.middleware).toEqual([]);
  });

  it("removes only this group's middleware from the stack after the callback", async () => {
    const groupMiddleware: Middleware = function groupGuard() {
      return undefined;
    };

    await withScope(() => {
      router.group({ prefix: "/g", middleware: [groupMiddleware] }, () => {
        router.get("/inside", () => undefined as any);
      });

      router.get("/outside", () => undefined as any);
    });

    const outside = scopedRoutes().find((route) => route.path === "/outside");

    expect(outside?.middleware).toEqual([]);
  });
});

describe("Router — getRoute", () => {
  it("returns the path for a named route", async () => {
    await withScope(() => {
      router.get("/static-route", () => undefined as any, { name: "staticRoute" });
    });

    expect(router.getRoute("staticRoute")).toBe("/static-route");
  });

  it("substitutes path params", async () => {
    await withScope(() => {
      router.get("/users/:id", () => undefined as any, { name: "userById" });
    });

    expect(router.getRoute("userById", { id: 42 })).toBe("/users/42");
  });

  it("throws for an unknown route name", () => {
    expect(() => router.getRoute("does-not-exist")).toThrow(/not found/);
  });
});

describe("Router — redirect", () => {
  it("registers a GET route for the source path", async () => {
    await withScope(() => {
      router.redirect("/old", "/new");
    });

    const [route] = scopedRoutes();

    expect(route.method).toBe("GET");
    expect(route.path).toBe("/old");
  });
});
