import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import type { RequestHandler } from "../../../src/router/types";

/**
 * `warlock dev` registers SSR page routes on the SAME router as API routes, so
 * pages and API share one route-name namespace. Failing hard on a collision is
 * correct — but the message has to say WHAT collided, or the developer has to
 * go hunting. These pin the diagnostic parts of that message.
 *
 * Source: core/src/router/router.ts (Router.add — duplicate name guard).
 */
const router = Router.getInstance();

const noop: RequestHandler = () => undefined as any;

let sourceFile = "";
let counter = 0;

function withScope(callback: () => void) {
  return router.withSourceFile(sourceFile, callback);
}

beforeEach(() => {
  sourceFile = `collision-source-${counter++}`;

  return () => {
    router.removeRoutesBySourceFile(sourceFile);
  };
});

describe("Router — duplicate route name", () => {
  it("names the colliding route name", async () => {
    await withScope(() => {
      router.get("/products", noop, { name: "products.list" });

      expect(() => router.get("/products-page", noop, { name: "products.list" })).toThrow(
        /Route name "products\.list" is already taken/,
      );
    });
  });

  it("says a page collided with an API route, and where each came from", async () => {
    let message = "";

    await router.withSourceFile("src/app/products/routes.ts", () => {
      router.get("/products", noop, { name: "products.list" });
    });

    await router.withSourceFile("src/app/products/products.page.tsx", () => {
      try {
        router.get("/products", noop, { name: "products.list", isPage: true });
      } catch (error) {
        message = (error as Error).message;
      }
    });

    router.removeRoutesBySourceFile("src/app/products/routes.ts");
    router.removeRoutesBySourceFile("src/app/products/products.page.tsx");

    // The claimant that is already registered is the API route ...
    expect(message).toContain("API route");
    expect(message).toContain("src/app/products/routes.ts");
    // ... and the one being added is the page.
    expect(message).toContain("page route");
    expect(message).toContain("src/app/products/products.page.tsx");
  });

  it("describes an API↔API collision as two API routes", async () => {
    let message = "";

    await withScope(() => {
      router.get("/products", noop, { name: "products.list" });

      try {
        router.get("/items", noop, { name: "products.list" });
      } catch (error) {
        message = (error as Error).message;
      }
    });

    expect(message).toContain("API route GET /products");
    expect(message).toContain("API route GET /items");
    expect(message).not.toContain("page route");
  });

  it("says the source file is unknown when the route was registered outside withSourceFile", () => {
    router.get("/unscoped-a", noop, { name: "unscoped.collision" });

    try {
      expect(() => router.get("/unscoped-b", noop, { name: "unscoped.collision" })).toThrow(
        /source file unknown/,
      );
    } finally {
      router.removeRoutesBySourceFile("");
    }
  });
});
