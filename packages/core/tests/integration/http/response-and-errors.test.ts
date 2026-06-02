import { afterEach, describe, expect, it } from "vitest";
import { v } from "@warlock.js/seal";
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  ResourceNotFoundError,
  ServerError,
  UnAuthorizedError,
} from "../../../src/http/errors";
import type { RequestHandler } from "../../../src/router/types";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * Controller-output concerns over the live path: response helpers map to the
 * right status + body, schema-bound handlers reject bad input with the
 * framework's error envelope and accept good input, and thrown `HttpError`
 * subclasses map to the correct status + JSON via the request-store error
 * handler.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("HTTP response helpers", () => {
  it("success() returns 200 with the given body as JSON", async () => {
    harness = await bootHarness((router) => {
      router.get("/ok", (_request, response) => response.success({ value: 1 }));
    });

    const result = await harness.inject({ method: "GET", url: "/ok" });

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(harness.json(result)).toEqual({ value: 1 });
  });

  it("success() defaults to { success: true } when no body is given", async () => {
    harness = await bootHarness((router) => {
      router.get("/ok-default", (_request, response) => response.success());
    });

    const result = await harness.inject({ method: "GET", url: "/ok-default" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ success: true });
  });

  it("successCreate() returns 201", async () => {
    harness = await bootHarness((router) => {
      router.post("/created", (_request, response) => response.successCreate({ id: 10 }));
    });

    const result = await harness.inject({ method: "POST", url: "/created", payload: {} });

    expect(result.statusCode).toBe(201);
    expect(harness.json(result)).toEqual({ id: 10 });
  });

  it("notFound() returns 404 with the default envelope", async () => {
    harness = await bootHarness((router) => {
      router.get("/missing", (_request, response) => response.notFound());
    });

    const result = await harness.inject({ method: "GET", url: "/missing" });

    expect(result.statusCode).toBe(404);
    expect(harness.json(result)).toEqual({ error: "notFound" });
  });

  it("badRequest() returns 400 with the given body", async () => {
    harness = await bootHarness((router) => {
      router.get("/bad", (_request, response) => response.badRequest({ error: "nope" }));
    });

    const result = await harness.inject({ method: "GET", url: "/bad" });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result)).toEqual({ error: "nope" });
  });

  it("unauthorized() returns 401 with the default envelope", async () => {
    harness = await bootHarness((router) => {
      router.get("/unauth", (_request, response) => response.unauthorized());
    });

    const result = await harness.inject({ method: "GET", url: "/unauth" });

    expect(result.statusCode).toBe(401);
    expect(harness.json(result)).toEqual({ error: "unauthorized" });
  });

  it("forbidden() returns 403", async () => {
    harness = await bootHarness((router) => {
      router.get("/forbidden", (_request, response) => response.forbidden({ error: "denied" }));
    });

    const result = await harness.inject({ method: "GET", url: "/forbidden" });

    expect(result.statusCode).toBe(403);
    expect(harness.json(result)).toEqual({ error: "denied" });
  });

  it("returns a plain object straight from the handler as JSON", async () => {
    harness = await bootHarness((router) => {
      router.get("/plain-object", () => ({ shaped: "directly" }));
    });

    const result = await harness.inject({ method: "GET", url: "/plain-object" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ shaped: "directly" });
  });
});

describe("HTTP validation — schema bound", () => {
  /**
   * Build a handler carrying a seal schema as its static `validation.schema`,
   * exactly as the router lifts it from a controller in production.
   */
  function makeValidatedHandler(): RequestHandler {
    const handler: RequestHandler = (request, response) => {
      return response.successCreate({ data: request.validated() });
    };

    handler.validation = {
      schema: v.object({
        name: v.string().required(),
        age: v.int().required(),
      }),
    };

    return handler;
  }

  it("rejects bad input with the framework's { errors: [{ input, error }] } envelope", async () => {
    harness = await bootHarness((router) => {
      router.post("/signup", makeValidatedHandler());
    });

    const result = await harness.inject({
      method: "POST",
      url: "/signup",
      payload: { name: "Sam" },
    });

    expect(result.statusCode).toBe(400);

    const body = harness.json(result);

    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toMatchObject({ input: "age" });
    expect(typeof body.errors[0].error).toBe("string");
  });

  it("accepts good input and exposes it via request.validated()", async () => {
    harness = await bootHarness((router) => {
      router.post("/signup-ok", makeValidatedHandler());
    });

    const result = await harness.inject({
      method: "POST",
      url: "/signup-ok",
      payload: { name: "Sam", age: 30 },
    });

    expect(result.statusCode).toBe(201);
    expect(harness.json(result)).toEqual({ data: { name: "Sam", age: 30 } });
  });

  it("short-circuits with a custom validate() result before the handler", async () => {
    const handler: RequestHandler = (_request, response) => response.success({ reached: true });

    handler.validation = {
      validate: (request, response) => {
        if (!request.input("token")) {
          return response.badRequest({ error: "token required" });
        }
      },
    };

    harness = await bootHarness((router) => {
      router.get("/custom-validate", handler);
    });

    const result = await harness.inject({ method: "GET", url: "/custom-validate" });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result)).toEqual({ error: "token required" });
  });
});

describe("HTTP error mapping — thrown HttpError subclasses", () => {
  it("maps a thrown BadRequestError to 400 with error + payload", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-bad", () => {
        throw new BadRequestError("bad input", { field: "email" });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-bad" });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result)).toMatchObject({
      error: "bad input",
      payload: { field: "email" },
    });
  });

  it("maps a thrown ResourceNotFoundError to 404", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-missing", () => {
        throw new ResourceNotFoundError("not here");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-missing" });

    expect(result.statusCode).toBe(404);
    expect(harness.json(result)).toMatchObject({ error: "not here" });
  });

  it("maps a thrown UnAuthorizedError to 401", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-unauth", () => {
        throw new UnAuthorizedError("no access");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-unauth" });

    expect(result.statusCode).toBe(401);
  });

  it("maps a thrown ForbiddenError to 403", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-forbidden", () => {
        throw new ForbiddenError("nope");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-forbidden" });

    expect(result.statusCode).toBe(403);
  });

  it("maps a thrown ServerError to 500", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-server", () => {
        throw new ServerError("boom");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-server" });

    expect(result.statusCode).toBe(500);
    expect(harness.json(result)).toMatchObject({ error: "boom" });
  });

  it("maps a generic HttpError to its own status code", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-teapot", () => {
        throw new HttpError(418, "i am a teapot");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-teapot" });

    expect(result.statusCode).toBe(418);
    expect(harness.json(result)).toMatchObject({ error: "i am a teapot" });
  });

  it("falls back to 400 for a non-HttpError thrown from the handler", async () => {
    harness = await bootHarness((router) => {
      router.get("/throw-plain", () => {
        throw new Error("unexpected");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/throw-plain" });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result)).toMatchObject({ error: "unexpected" });
  });

  it("omits the stack in non-development environments", async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      harness = await bootHarness((router) => {
        router.get("/throw-prod", () => {
          throw new HttpError(400, "prod error");
        });
      });

      const result = await harness.inject({ method: "GET", url: "/throw-prod" });

      expect(harness.json(result).stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });

  it("includes the stack in development", async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      harness = await bootHarness((router) => {
        router.get("/throw-dev", () => {
          throw new HttpError(400, "dev error");
        });
      });

      const result = await harness.inject({ method: "GET", url: "/throw-dev" });

      expect(typeof harness.json(result).stack).toBe("string");
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
