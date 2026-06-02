import { beforeEach, describe, expect, it } from "vitest";
import { RouteBuilder } from "../../../src/router/route-builder";
import { Router } from "../../../src/router/router";
import type { RequestHandler, Route } from "../../../src/router/types";

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

/** A method→path map for the routes the current test registered. */
function methodPaths(): Array<[string, string]> {
  return scopedRoutes().map((route) => [route.method, route.path]);
}

beforeEach(() => {
  sourceFile = `builder-source-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("RouteBuilder — chainable verbs", () => {
  it("router.route() returns a RouteBuilder for the path", () => {
    const builder = router.route("/posts");

    expect(builder).toBeInstanceOf(RouteBuilder);
  });

  it("registers collection verbs on the base path", async () => {
    await withScope(() => {
      router.route("/posts").get(noop).post(noop);
    });

    expect(methodPaths()).toEqual([
      ["GET", "/posts"],
      ["POST", "/posts"],
    ]);
  });

  it("appends /:id for the *One helpers", async () => {
    await withScope(() => {
      router.route("/posts").getOne(noop).updateOne(noop).deleteOne(noop).patchOne(noop);
    });

    expect(methodPaths()).toEqual([
      ["GET", "/posts/:id"],
      ["PUT", "/posts/:id"],
      ["DELETE", "/posts/:id"],
      ["PATCH", "/posts/:id"],
    ]);
  });

  it("throws when the same verb is declared twice on one builder", async () => {
    await expect(
      withScope(() => {
        router.route("/posts").get(noop).get(noop);
      }),
    ).resolves.toBeUndefined();

    // The first get() lands before the duplicate throws.
    expect(methodPaths()).toEqual([["GET", "/posts"]]);
  });
});

describe("RouteBuilder — RESTful semantic aliases", () => {
  it("maps list/create/show/update/destroy to the right method+path", async () => {
    await withScope(() => {
      router
        .route("/articles")
        .list(noop)
        .create(noop)
        .show(noop)
        .update(noop)
        .destroy(noop);
    });

    expect(methodPaths()).toEqual([
      ["GET", "/articles"],
      ["POST", "/articles"],
      ["GET", "/articles/:id"],
      ["PUT", "/articles/:id"],
      ["DELETE", "/articles/:id"],
    ]);
  });
});

describe("RouteBuilder — crud()", () => {
  it("registers only the handlers that are provided", async () => {
    await withScope(() => {
      router.route("/comments").crud({
        list: noop,
        show: noop,
      });
    });

    expect(methodPaths()).toEqual([
      ["GET", "/comments"],
      ["GET", "/comments/:id"],
    ]);
  });

  it("registers the full CRUD surface when every handler is supplied", async () => {
    await withScope(() => {
      router.route("/tags").crud({
        list: noop,
        create: noop,
        show: noop,
        update: noop,
        destroy: noop,
        patch: noop,
      });
    });

    expect(methodPaths()).toEqual([
      ["GET", "/tags"],
      ["POST", "/tags"],
      ["GET", "/tags/:id"],
      ["PUT", "/tags/:id"],
      ["DELETE", "/tags/:id"],
      ["PATCH", "/tags/:id"],
    ]);
  });
});

describe("RouteBuilder — nest()", () => {
  it("creates a builder whose path is the parent path joined with the child", async () => {
    await withScope(() => {
      router.route("/posts/:id").getOne(noop).nest("/comments").list(noop).create(noop);
    });

    expect(methodPaths()).toEqual([
      ["GET", "/posts/:id/:id"],
      ["GET", "/posts/:id/comments"],
      ["POST", "/posts/:id/comments"],
    ]);
  });

  it("carries the parent options into the nested builder", async () => {
    await withScope(() => {
      router
        .route("/parent", { description: "parent-desc" })
        .nest("/child")
        .list(noop);
    });

    const nested = scopedRoutes().find((route) => route.path === "/parent/child");

    expect(nested?.description).toBe("parent-desc");
  });
});
