import { afterEach, describe, expect, it } from "vitest";
import type { Middleware } from "../../../src/router/types";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * Middleware behaviour across the real request lifecycle: ordering, the
 * short-circuit contract (a middleware that returns a response stops the chain
 * and skips the handler), guarded routes, and group-applied middleware.
 *
 * Every assertion runs through `request.runMiddleware()` as driven by the
 * Fastify handler, so the order and short-circuit semantics are the production
 * ones, not a unit-level simulation.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("HTTP middleware — ordering", () => {
  it("runs route middleware in declared order before the handler", async () => {
    const trail: string[] = [];

    harness = await bootHarness((router) => {
      const first: Middleware = () => {
        trail.push("first");
      };

      const second: Middleware = () => {
        trail.push("second");
      };

      router.get(
        "/ordered",
        (_request, response) => {
          trail.push("handler");

          return response.success({ trail });
        },
        { middleware: [first, second] },
      );
    });

    const result = await harness.inject({ method: "GET", url: "/ordered" });

    expect(result.statusCode).toBe(200);
    expect(trail).toEqual(["first", "second", "handler"]);
  });
});

describe("HTTP middleware — short-circuit", () => {
  it("stops the chain and skips the handler when a middleware returns a response", async () => {
    const trail: string[] = [];

    harness = await bootHarness((router) => {
      const blocker: Middleware = (_request, response) => {
        trail.push("blocker");

        return response.badRequest({ error: "blocked" });
      };

      const neverRuns: Middleware = () => {
        trail.push("neverRuns");
      };

      router.get(
        "/blocked",
        (_request, response) => {
          trail.push("handler");

          return response.success();
        },
        { middleware: [blocker, neverRuns] },
      );
    });

    const result = await harness.inject({ method: "GET", url: "/blocked" });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result)).toEqual({ error: "blocked" });
    expect(trail).toEqual(["blocker"]);
  });

  it("continues into the handler when every middleware passes through", async () => {
    harness = await bootHarness((router) => {
      const passThrough: Middleware = () => undefined;

      router.get(
        "/passes",
        (_request, response) => response.success({ reached: true }),
        { middleware: [passThrough] },
      );
    });

    const result = await harness.inject({ method: "GET", url: "/passes" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ reached: true });
  });
});

describe("HTTP middleware — guarded route", () => {
  it("rejects an unauthenticated request with 401 before the handler", async () => {
    const guard: Middleware = (request, response) => {
      if (!request.header("authorization")) {
        return response.unauthorized({ error: "no token" });
      }
    };

    harness = await bootHarness((router) => {
      router.get(
        "/guarded",
        (_request, response) => response.success({ secret: "value" }),
        { middleware: [guard] },
      );
    });

    const result = await harness.inject({ method: "GET", url: "/guarded" });

    expect(result.statusCode).toBe(401);
    expect(harness.json(result)).toEqual({ error: "no token" });
  });

  it("lets an authenticated request reach the handler", async () => {
    const guard: Middleware = (request, response) => {
      if (!request.header("authorization")) {
        return response.unauthorized({ error: "no token" });
      }
    };

    harness = await bootHarness((router) => {
      router.get(
        "/guarded-ok",
        (_request, response) => response.success({ secret: "value" }),
        { middleware: [guard] },
      );
    });

    const result = await harness.inject({
      method: "GET",
      url: "/guarded-ok",
      headers: { authorization: "Bearer abc" },
    });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ secret: "value" });
  });
});

describe("HTTP middleware — group middleware", () => {
  it("applies group middleware ahead of route middleware", async () => {
    const trail: string[] = [];

    harness = await bootHarness((router) => {
      const groupMiddleware: Middleware = () => {
        trail.push("group");
      };

      const routeMiddleware: Middleware = () => {
        trail.push("route");
      };

      router.group({ prefix: "/admin", middleware: [groupMiddleware] }, () => {
        router.get(
          "/dashboard",
          (_request, response) => {
            trail.push("handler");

            return response.success({ trail });
          },
          { middleware: [routeMiddleware] },
        );
      });
    });

    const result = await harness.inject({ method: "GET", url: "/admin/dashboard" });

    expect(result.statusCode).toBe(200);
    // Group middleware is unshifted ahead of route middleware (precedence "after").
    expect(trail).toEqual(["group", "route", "handler"]);
  });

  it("lets group middleware short-circuit a route inside the group", async () => {
    harness = await bootHarness((router) => {
      const denyAll: Middleware = (_request, response) => response.forbidden({ error: "denied" });

      router.group({ prefix: "/locked", middleware: [denyAll] }, () => {
        router.get("/page", (_request, response) => response.success({ reached: true }));
      });
    });

    const result = await harness.inject({ method: "GET", url: "/locked/page" });

    expect(result.statusCode).toBe(403);
    expect(harness.json(result)).toEqual({ error: "denied" });
  });
});
