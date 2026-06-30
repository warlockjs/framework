import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import type { Route } from "../../../src/router/types";

/**
 * The router is a process-wide singleton with a shared `routes` array. To keep
 * each test isolated we tag every route added inside a test with a unique
 * `sourceFile` (via `withSourceFile`) and clear it in `afterEach` — and we read
 * results back through a `sourceFile`-scoped filter so a leaked route from
 * another suite can never bleed into an assertion.
 */
const router = Router.getInstance();

let sourceFile = "";
let counter = 0;

/**
 * Add routes inside the current test's source-file scope. `withSourceFile`
 * stamps each registered route with `sourceFile`, which we use both for
 * cleanup and for scoping assertions.
 */
function withScope(callback: () => void) {
  return router.withSourceFile(sourceFile, callback);
}

/** Every route registered by the current test, in registration order. */
function scopedRoutes(): Route[] {
  return router.list().filter((route) => route.sourceFile === sourceFile);
}

beforeEach(() => {
  sourceFile = `test-source-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("Router — verb registration", () => {
  it("registers a GET route with method, path and a derived name", async () => {
    await withScope(() => {
      router.get("/users", () => undefined as any);
    });

    const [route] = scopedRoutes();

    expect(route.method).toBe("GET");
    expect(route.path).toBe("/users");
    expect(route.name).toBe("users");
  });

  it("maps each verb helper to the matching HTTP method", async () => {
    await withScope(() => {
      router.get("/get-path", () => undefined as any);
      router.post("/post-path", () => undefined as any);
      router.put("/put-path", () => undefined as any);
      router.patch("/patch-path", () => undefined as any);
      router.delete("/delete-path", () => undefined as any);
      router.head("/head-path", () => undefined as any);
      router.options("/options-path", () => undefined as any);
    });

    const methods = scopedRoutes().map((route) => route.method);

    expect(methods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  });

  it("registers `any` as the wildcard `all` method", async () => {
    await withScope(() => {
      router.any("/any-path", () => undefined as any);
    });

    expect(scopedRoutes()[0].method).toBe("all");
  });

  it("expands an array of paths into one route each, sharing the handler", async () => {
    await withScope(() => {
      router.post(["/a", "/b", "/c"], () => undefined as any);
    });

    const paths = scopedRoutes().map((route) => route.path);

    expect(paths).toEqual(["/a", "/b", "/c"]);
  });

  it("honours an explicit route name over the derived one", async () => {
    await withScope(() => {
      router.get("/profile", () => undefined as any, { name: "myProfile" });
    });

    expect(scopedRoutes()[0].name).toBe("myProfile");
  });

  it("derives a dotted name from a nested path", async () => {
    await withScope(() => {
      router.get("/admin/users/list", () => undefined as any);
    });

    expect(scopedRoutes()[0].name).toBe("admin.users.list");
  });

  it("defaults $prefix to '/' when no group prefix is active", async () => {
    await withScope(() => {
      router.get("/loose", () => undefined as any);
    });

    expect(scopedRoutes()[0].$prefix).toBe("/");
    expect(scopedRoutes()[0].$prefixStack).toEqual([]);
  });

  it("stamps the active sourceFile onto the route", async () => {
    await withScope(() => {
      router.get("/tracked", () => undefined as any);
    });

    expect(scopedRoutes()[0].sourceFile).toBe(sourceFile);
  });
});

describe("Router — name collisions", () => {
  it("rethrows when the same name is reused for the same method", async () => {
    // withSourceFile no longer swallows: a duplicate-name throw propagates so
    // the whole route file fails loudly instead of half-registering silently.
    await expect(
      withScope(() => {
        router.get("/dup", () => undefined as any, { name: "dup" });
        router.get("/dup2", () => undefined as any, { name: "dup" });
      }),
    ).rejects.toThrow(/Route name "dup" already exists/);

    // The first route still landed before the second threw.
    expect(scopedRoutes().map((route) => route.path)).toEqual(["/dup"]);
  });

  it("disambiguates a duplicate name across different methods with a .method suffix", async () => {
    await withScope(() => {
      router.get("/resource", () => undefined as any, { name: "resource" });
      router.post("/resource", () => undefined as any, { name: "resource" });
    });

    const names = scopedRoutes().map((route) => route.name);

    expect(names).toEqual(["resource", "resource.post"]);
  });
});

describe("Router — withSourceFile failure surfacing", () => {
  it("rethrows an arbitrary error thrown inside the callback", async () => {
    await expect(
      withScope(() => {
        throw new Error("boom from a route file");
      }),
    ).rejects.toThrow(/boom from a route file/);
  });

  it("clears the sourceFile stack even when the callback throws", async () => {
    await expect(
      withScope(() => {
        throw new Error("still cleans up");
      }),
    ).rejects.toThrow();

    // A subsequent successful registration must not carry the failed file's
    // sourceFile — proving the finally block cleared the stack.
    const cleanSource = `${sourceFile}-after`;
    await router.withSourceFile(cleanSource, () => {
      router.get("/after-throw", () => undefined as any);
    });

    const route = router.list().find((r) => r.path === "/after-throw");
    expect(route?.sourceFile).toBe(cleanSource);
    router.removeRoutesBySourceFile(cleanSource);
  });
});

describe("Router — routeCount readiness signal", () => {
  it("reflects the number of registered routes", async () => {
    const before = router.routeCount();

    await withScope(() => {
      router.get("/count-a", () => undefined as any);
      router.get("/count-b", () => undefined as any);
    });

    expect(router.routeCount()).toBe(before + 2);
    expect(router.routeCount()).toBe(router.list().length);
  });
});

describe("Router — controller-array handlers", () => {
  it("binds [controller, action] into a callable handler", async () => {
    const controller = {
      list() {
        return "listed" as any;
      },
    };

    await withScope(() => {
      router.get("/controller-list", [controller, "list"]);
    });

    const handler = scopedRoutes()[0].handler;

    expect(typeof handler).toBe("function");
    expect((handler as any)()).toBe("listed");
  });

  it("rethrows when the controller action is not a function", async () => {
    const controller = { notAFunction: 123 };

    // The invalid-action throw now propagates out of withSourceFile rather
    // than being swallowed, so a misconfigured route file aborts loudly.
    await expect(
      withScope(() => {
        router.get("/bad-controller", [controller, "notAFunction"]);
      }),
    ).rejects.toThrow(/Invalid controller action "notAFunction"/);

    expect(scopedRoutes()).toHaveLength(0);
  });

  it("lifts `${action}ValidationSchema` onto handler.validation.schema", async () => {
    const schemaToken = { __schema: true };
    const controller = {
      create() {
        return undefined as any;
      },
      createValidationSchema() {
        return schemaToken;
      },
    };

    await withScope(() => {
      router.post("/with-validation", [controller, "create"]);
    });

    const handler = scopedRoutes()[0].handler;

    expect(handler.validation?.schema).toBe(schemaToken);
  });
});
