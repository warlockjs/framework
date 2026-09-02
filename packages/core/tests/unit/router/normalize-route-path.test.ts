import { afterEach, describe, expect, it } from "vitest";
import { normalizeRoutePath } from "../../../src/router/normalize-route-path";
import { Router } from "../../../src/router/router";
import type { RequestHandler } from "../../../src/router/types";

/**
 * `normalizeRoutePath` exists so that anything PREDICTING a route path — the
 * build-time page-route manifest above all — produces the identical string the
 * router produces when it REGISTERS one. The second describe below is the part
 * that matters: it pins the two together rather than asserting a hard-coded
 * shape twice.
 *
 * Source: core/src/router/normalize-route-path.ts, core/src/router/router.ts
 * (Router.add).
 */
const router = Router.getInstance();

const noop: RequestHandler = () => undefined as never;

const SOURCE = "normalize-route-path.test.ts";

afterEach(() => {
  router.removeRoutesBySourceFile(SOURCE);
});

describe("normalizeRoutePath", () => {
  it("gives the not-found catch-all its leading slash", () => {
    // The whole reason this is exported: the page-route manifest holds the raw
    // `"*"` constant while the router serves `"/*"`.
    expect(normalizeRoutePath("*")).toBe("/*");
  });

  it("is idempotent — normalizing an already-canonical path changes nothing", () => {
    for (const path of ["/*", "/", "/users", "/users/:id"]) {
      expect(normalizeRoutePath(path)).toBe(path);
      expect(normalizeRoutePath(normalizeRoutePath(path))).toBe(path);
    }
  });

  it("joins segments and collapses stray slashes", () => {
    expect(normalizeRoutePath("/users/", "/:id")).toBe("/users/:id");
    expect(normalizeRoutePath("", "/users")).toBe("/users");
    expect(normalizeRoutePath("/")).toBe("/");
  });
});

describe("normalizeRoutePath is the router's own path form", () => {
  it("produces exactly the path the router registers for the catch-all", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.get("*", noop, { name: "normalize.catch-all" });
    });

    const registered = router.list().find((route) => route.name === "normalize.catch-all");

    expect(registered).toBeDefined();
    // One call, one string. If `Router.add` ever stops going through this
    // function, the manifest can drift from the router again — and this fails.
    expect(registered?.path).toBe(normalizeRoutePath("*"));
  });

  it("produces exactly the path the router registers under a group prefix", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.group({ prefix: "/api", name: "normalize" }, () => {
        router.get("/users/", noop, { name: "grouped" });
      });
    });

    const registered = router.list().find((route) => route.path === "/api/users");

    expect(registered).toBeDefined();
    expect(registered?.path).toBe(normalizeRoutePath("/api", "/users/"));
  });
});
