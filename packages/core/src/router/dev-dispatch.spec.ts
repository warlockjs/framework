/**
 * Dev/prod router parity (finding C1:B21): HEAD-only, OPTIONS, per-route
 * rateLimit and the 404 body behave under `scanDevServer` as they do in `scan`.
 */
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as corsOptions from "../http/build-cors-options";
import { buildNotFoundBody } from "./dev-dispatch";
import { router } from "./router";

const handled = (route: any) => async (_request: any, reply: any) => {
  reply.code(200).header("x-route", route.method + ":" + route.path);

  return { output: "ok", response: { baseResponse: undefined } };
};

async function devServer(withRateLimit = true): Promise<FastifyInstance> {
  const server = Fastify();

  if (withRateLimit) {
    await server.register(fastifyRateLimit, { global: false });
  }

  router.scanDevServer(server);

  await server.ready();

  return server;
}

describe("dev router parity", () => {
  let server: FastifyInstance | undefined;

  beforeEach(() => {
    (router as any).routes = [];
    vi.spyOn(router as any, "handleRoute").mockImplementation(handled as any);
  });

  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    (router as any).routes = [];
  });

  it("serves an explicit HEAD-only route", async () => {
    router.head("/only-head", (() => undefined) as any);
    server = await devServer();

    const response = await server.inject({ method: "HEAD", url: "/only-head" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-route"]).toBe("HEAD:/only-head");
  });

  it("serves an OPTIONS route when cors preflight is off", async () => {
    vi.spyOn(corsOptions, "buildCorsOptions").mockReturnValue({ preflight: false });
    router.options("/opts", (() => undefined) as any);
    server = await devServer();

    const response = await server.inject({ method: "OPTIONS", url: "/opts" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-route"]).toBe("OPTIONS:/opts");
  });

  // The real app registers @fastify/cors, which owns OPTIONS "*" and loads
  // after scanDevServer: a second OPTIONS wildcard crashed dev boot.
  it("boots beside @fastify/cors and leaves preflight to it", async () => {
    server = Fastify();
    router.get("/page", (() => undefined) as any);
    router.scanDevServer(server);
    server.register(fastifyCors, { origin: "*" });

    await server.ready();

    const preflight = await server.inject({
      method: "OPTIONS",
      url: "/page",
      headers: { origin: "http://example.test", "access-control-request-method": "GET" },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
  });

  it("applies a per-route rateLimit", async () => {
    router.get("/limited", (() => undefined) as any, {
      rateLimit: { max: 1, timeWindow: 60_000 },
    } as any);
    server = await devServer();

    const first = await server.inject({ method: "GET", url: "/limited" });
    const second = await server.inject({ method: "GET", url: "/limited" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it("answers an unknown URL with Fastify's default 404 body", async () => {
    server = await devServer();

    const response = await server.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(buildNotFoundBody("GET", "/nope"));
    expect(response.json()).toEqual({
      message: "Route GET:/nope not found",
      error: "Not Found",
      statusCode: 404,
    });
  });
});
