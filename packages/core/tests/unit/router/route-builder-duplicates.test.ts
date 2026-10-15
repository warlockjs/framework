import { beforeEach, describe, expect, it } from "vitest";
import { RouteBuilder } from "../../../src/router/route-builder";
import { Router } from "../../../src/router/router";
import type { RequestHandler, Route } from "../../../src/router/types";

/**
 * Each verb on RouteBuilder guards against being declared twice on the same
 * builder. route-builder.test.ts pins the GET guard; this pins the POST / PUT /
 * PATCH / DELETE guards too, plus the `postOne` /:id helper that the base suite
 * does not touch. Source: core/src/router/route-builder.ts.
 */
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

beforeEach(() => {
  sourceFile = `builder-dup-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("RouteBuilder — second declaration of a verb throws", () => {
  const verbs = ["post", "put", "patch", "delete"] as const;

  for (const verb of verbs) {
    it(`throws when ${verb.toUpperCase()} is declared twice`, () => {
      const builder = new RouteBuilder(router, `/dup-${verb}`);

      builder[verb](noop);

      expect(() => builder[verb](noop)).toThrow(
        new RegExp(`already has a ${verb.toUpperCase()} method`),
      );
    });
  }
});

describe("RouteBuilder — postOne", () => {
  it("registers a POST on the /:id path", async () => {
    await withScope(() => {
      router.route("/uploads").postOne(noop);
    });

    expect(scopedRoutes().map((route) => [route.method, route.path])).toEqual([
      ["POST", "/uploads/:id"],
    ]);
  });
});
