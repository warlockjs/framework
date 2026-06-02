import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import type { RequestHandler, Route, RouteResource } from "../../../src/router/types";

const router = Router.getInstance();

const noop: RequestHandler = () => undefined as any;

let sourceFile = "";
let counter = 0;

function withScope(callback: () => void) {
  return router.withSourceFile(sourceFile, callback);
}

function scopedRoutes(): Route[] {
  return router.list().filter((route) => route.sourceFile === sourceFile);
}

/** method + path + name triples for the routes the current test registered. */
function shape(): Array<{ method: string; path: string; name: string | undefined }> {
  return scopedRoutes().map((route) => ({
    method: route.method,
    path: route.path,
    name: route.name,
  }));
}

/** A resource exposing every CRUD action as a plain function. */
function fullResource(): RouteResource {
  return {
    list: noop,
    get: noop,
    create: noop,
    update: noop,
    patch: noop,
    delete: noop,
    bulkDelete: noop,
  };
}

beforeEach(() => {
  sourceFile = `restful-source-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("Router.restfulResource — full chain", () => {
  it("registers the canonical CRUD routes with the expected methods and paths", async () => {
    await withScope(() => {
      router.restfulResource("/users", fullResource(), { name: "users" });
    });

    const methodPaths = shape().map((entry) => `${entry.method} ${entry.path}`);

    expect(methodPaths).toEqual([
      "GET /users",
      "GET /users/:id",
      "POST /users",
      "PUT /users/:id",
      "PATCH /users/:id",
      "DELETE /users/:id",
      "DELETE /users",
    ]);
  });

  it("suffixes resource names with .list/.single/.create/.update/.patch/.delete/.bulkDelete", async () => {
    await withScope(() => {
      router.restfulResource("/users", fullResource(), { name: "users" });
    });

    // NOTE: the `users` base is doubled (`users.users.*`) because the wrapping
    // `prefix("/users")` group auto-derives the name segment `users` from the
    // path AND `options.name` re-applies `users` as the resource base. This
    // pins the CURRENT behavior; the doubling is tracked as a naming defect.
    expect(shape().map((entry) => entry.name)).toEqual([
      "users.users.list",
      "users.users.single",
      "users.users.create",
      "users.users.update",
      "users.users.patch",
      "users.users.delete",
      "users.users.bulkDelete",
    ]);
  });

  it("flags every generated route as restful", async () => {
    await withScope(() => {
      router.restfulResource("/users", fullResource(), { name: "users" });
    });

    expect(scopedRoutes().every((route) => route.restful === true)).toBe(true);
  });

  it("nests routes under the resource prefix", async () => {
    await withScope(() => {
      router.restfulResource("/admin/posts", fullResource(), { name: "posts" });
    });

    const listRoute = scopedRoutes().find((route) => route.path === "/admin/posts");

    expect(listRoute?.method).toBe("GET");
    expect(listRoute?.$prefixStack).toContain("/admin/posts");
    // The path's own segments feed the auto-derived group name too, so the
    // multi-segment base shows up as `admin.posts.posts.list`.
    expect(listRoute?.name).toBe("admin.posts.posts.list");
  });
});

describe("Router.restfulResource — only / except", () => {
  it("registers just the actions named in `only`", async () => {
    await withScope(() => {
      router.restfulResource("/users", fullResource(), {
        name: "users",
        only: ["list", "get"],
      });
    });

    const methodPaths = shape().map((entry) => `${entry.method} ${entry.path}`);

    expect(methodPaths).toEqual(["GET /users", "GET /users/:id"]);
  });

  it("registers everything except the actions named in `except`", async () => {
    await withScope(() => {
      router.restfulResource("/users", fullResource(), {
        name: "users",
        except: ["create", "update", "patch"],
      });
    });

    const methods = shape().map((entry) => `${entry.method} ${entry.path}`);

    // delete + bulkDelete both survive because `except` only lists create/update/patch.
    expect(methods).toEqual([
      "GET /users",
      "GET /users/:id",
      "DELETE /users/:id",
      "DELETE /users",
    ]);
  });
});

describe("Router.restfulResource — partial resources", () => {
  it("skips actions the resource does not implement", async () => {
    const readOnly: RouteResource = {
      list: noop,
      get: noop,
    };

    await withScope(() => {
      router.restfulResource("/reports", readOnly, { name: "reports" });
    });

    const methodPaths = shape().map((entry) => `${entry.method} ${entry.path}`);

    expect(methodPaths).toEqual(["GET /reports", "GET /reports/:id"]);
  });
});

describe("Router.restfulResource — replace", () => {
  it("uses the replacement handler for an action", async () => {
    const replacement: RequestHandler = function customList() {
      return "custom" as any;
    };

    await withScope(() => {
      router.restfulResource("/users", fullResource(), {
        name: "users",
        only: ["list"],
        replace: { list: replacement },
      });
    });

    expect(scopedRoutes()[0].handler).toBe(replacement);
  });
});
