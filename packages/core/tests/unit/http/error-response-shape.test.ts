import { afterEach, describe, expect, it } from "vitest";
import {
  BadRequestError,
  ForbiddenError,
  ResourceNotFoundError,
  ServerError,
  UnAuthorizedError,
} from "../../../src/http/errors";
import { bootHarness, type HttpHarness } from "../../integration/http/harness";

/**
 * `handleRequestError` (`src/http/middleware/inject-request-context.ts`) checks
 * `error instanceof HttpError` first. `ResourceNotFoundError`, `UnAuthorizedError`,
 * `ForbiddenError`, `BadRequestError` and `ServerError` all extend `HttpError`, so
 * `instanceof` matches every one of them there and returns before their own
 * `instanceof` branches further down ever run — those five branches are dead code.
 *
 * This matters because the two shapes differ: the live `HttpError` branch NESTS
 * the caller's payload under a `payload` key; the shadowed branches would have
 * SPREAD it flat alongside `error`. This suite proves, by observing the actual
 * response body `fastify.inject` delivers for each of the five types (each thrown
 * with a payload), that the nested shape is what ships — i.e. the `HttpError`
 * branch produced it, not the type's own dead branch below it.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("error response shape — HttpError subclasses all produce the nested shape", () => {
  it("ResourceNotFoundError: nested payload shape, not flat", async () => {
    harness = await bootHarness((router) => {
      router.get("/not-found", () => {
        throw new ResourceNotFoundError("missing thing", { id: 42 });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/not-found" });
    const body = harness.json(result);

    expect(result.statusCode).toBe(404);
    expect(body).toEqual({ error: "missing thing", payload: { id: 42 } });
  });

  it("UnAuthorizedError: nested payload shape, not flat", async () => {
    harness = await bootHarness((router) => {
      router.get("/unauthorized", () => {
        throw new UnAuthorizedError("nope", { reason: "no-token" });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/unauthorized" });
    const body = harness.json(result);

    expect(result.statusCode).toBe(401);
    expect(body).toEqual({ error: "nope", payload: { reason: "no-token" } });
  });

  it("ForbiddenError: nested payload shape, not flat", async () => {
    harness = await bootHarness((router) => {
      router.get("/forbidden", () => {
        throw new ForbiddenError("blocked", { policy: "admin-only" });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/forbidden" });
    const body = harness.json(result);

    expect(result.statusCode).toBe(403);
    expect(body).toEqual({ error: "blocked", payload: { policy: "admin-only" } });
  });

  it("BadRequestError: nested payload shape, not flat", async () => {
    harness = await bootHarness((router) => {
      router.get("/bad-request", () => {
        throw new BadRequestError("invalid input", { field: "email" });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/bad-request" });
    const body = harness.json(result);

    expect(result.statusCode).toBe(400);
    expect(body).toEqual({ error: "invalid input", payload: { field: "email" } });
  });

  it("ServerError: nested payload shape, not flat", async () => {
    harness = await bootHarness((router) => {
      router.get("/server-error", () => {
        throw new ServerError("kaboom", { trace: "abc123" });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/server-error" });
    const body = harness.json(result);

    expect(result.statusCode).toBe(500);
    expect(body).toEqual({ error: "kaboom", payload: { trace: "abc123" } });
  });
});
