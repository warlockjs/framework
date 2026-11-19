import rateLimit from "@fastify/rate-limit";
import { log } from "@warlock.js/logger";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { excludeFromRequestLog } from "../http/request-log";
import { answerUnknownUrl, router } from "./router";

afterEach(() => {
  router.removeRoutesBySourceFile("answer-unknown-url.spec");
  vi.restoreAllMocks();
});

/** Registers routes under this spec's source file, so `afterEach` removes them. */
function routes(register: () => void): Promise<void> {
  return router.withSourceFile("answer-unknown-url.spec", async () => register());
}

/** A plugin under `/closed` that refuses every request through `answerUnknownUrl`. */
async function mountClosed(server: FastifyInstance): Promise<void> {
  await server.register(
    async (instance) => {
      instance.addHook("onRequest", async (request, reply) => {
        if (!(await answerUnknownUrl(request, reply))) reply.callNotFound();

        return reply;
      });
      instance.get("/*", async () => ({ open: true }));
      instance.post("/*", async () => ({ open: true }));
    },
    { prefix: "/closed" },
  );
}

const RATE_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

describe("answerUnknownUrl", () => {
  it("resolves false when the app has no catch-all route", async () => {
    const server = Fastify();

    server.get("/inside/*", async (request, reply) => {
      expect(await answerUnknownUrl(request, reply)).toBe(false);

      return reply.callNotFound();
    });

    const response = await server.inject({ method: "GET", url: "/inside/x" });

    expect(response.statusCode).toBe(404);
  });

  it("answers through the catch-all route, with its handler, from another context", async () => {
    await router.withSourceFile("answer-unknown-url.spec", async () => {
      router.get("/*", ({ request, response }) =>
        response.send({ error: "nothing here", path: request.path }, 404),
      );
    });

    const server = Fastify();

    router.scan(server);
    await server.register(async (instance) => {
      instance.get("/closed/*", async (request, reply) => {
        await answerUnknownUrl(request, reply);

        return reply;
      });
    });

    const closed = await server.inject({ method: "GET", url: "/closed/a" });
    const unknown = await server.inject({ method: "GET", url: "/other" });

    expect(closed.statusCode).toBe(404);
    expect(closed.json()).toEqual({ error: "nothing here", path: "/closed/a" });
    expect(unknown.json()).toEqual({ error: "nothing here", path: "/other" });
  });

  it("applies the global rate limit the catch-all route gets: headers, then the same 429", async () => {
    await routes(() => {
      router.get("/*", ({ response }) => response.send({ error: "nothing here" }, 404));
    });

    const server = Fastify();

    await server.register(rateLimit, { max: 3, timeWindow: 60_000 });
    router.scan(server);
    await mountClosed(server);

    const unknown = await server.inject({ method: "GET", url: "/other" });
    const closed = await server.inject({ method: "GET", url: "/closed/api" });

    for (const name of RATE_HEADERS) {
      expect(unknown.headers[name]).toBeDefined();
      expect(closed.headers[name]).toBeDefined();
    }

    // One bucket: the closed request counted like the unknown one.
    expect(closed.headers["x-ratelimit-remaining"]).toBe("1");

    await server.inject({ method: "GET", url: "/other" });

    const limitedUnknown = await server.inject({ method: "GET", url: "/other" });
    const limitedClosed = await server.inject({ method: "GET", url: "/closed/api" });

    expect(limitedUnknown.statusCode).toBe(429);
    expect(limitedClosed.statusCode).toBe(429);
    expect(limitedClosed.json()).toEqual(limitedUnknown.json());
  });

  it("answers through the app route that would match the URL, with that route's params", async () => {
    await routes(() => {
      router.get("/*", ({ response }) => response.send({ from: "catch-all" }, 404));
      router.get("/:locale/*", ({ request, response }) =>
        response.send({ from: "locale", locale: request.input("locale") }, 404),
      );
    });

    const server = Fastify();

    router.scan(server);
    await mountClosed(server);

    const closed = await server.inject({ method: "GET", url: "/closed/api" });
    const unknown = await server.inject({ method: "GET", url: "/fr/api" });

    expect(unknown.json()).toEqual({ from: "locale", locale: "fr" });
    expect(closed.json()).toEqual({ from: "locale", locale: "closed" });
  });

  it("runs no other app handler for a method with a body: only a catch-all answers", async () => {
    await routes(() => {
      router.post("/:locale/*", ({ response }) => response.send({ created: true }, 201));
    });

    const server = Fastify();

    router.scan(server);
    await mountClosed(server);

    const closed = await server.inject({ method: "POST", url: "/closed/api", payload: {} });

    expect(closed.statusCode).toBe(404);
    expect(closed.json()).not.toHaveProperty("created");
  });

  it("hands an error the catch-all throws to Fastify's error handling, as the route itself would", async () => {
    const teapot = Object.assign(new Error("short and stout"), { statusCode: 418 });

    await routes(() => {
      router.get("/*", () => undefined as never, {
        serverOptions: {
          onRequest: async () => {
            throw teapot;
          },
        },
      });
    });

    const server = Fastify();

    router.scan(server);
    await mountClosed(server);

    const closed = await server.inject({ method: "GET", url: "/closed/api" });
    const unknown = await server.inject({ method: "GET", url: "/other" });

    expect(unknown.statusCode).toBe(418);
    expect(closed.statusCode).toBe(418);
    expect(closed.json()).toEqual(unknown.json());
  });

  it("writes no request lifecycle line for a path excluded from the request log", async () => {
    await routes(() => {
      router.get("/*", ({ response }) => response.send({ error: "nothing here" }, 404));
    });

    vi.spyOn(log, "isEnabled").mockReturnValue(true);

    const info = vi.spyOn(log, "info").mockImplementation(() => log);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);
    const lines = () =>
      [...info.mock.calls, ...warn.mock.calls].map((call) => JSON.stringify(call[0]));
    const stop = excludeFromRequestLog("/closed");

    try {
      const server = Fastify();

      router.scan(server);
      await mountClosed(server);

      await server.inject({ method: "GET", url: "/closed/private-place" });

      expect(lines().filter((line) => line.includes("private-place"))).toEqual([]);

      await server.inject({ method: "GET", url: "/visible-place" });

      // The spies see the lines of a path that is not excluded.
      expect(lines().some((line) => line.includes("visible-place"))).toBe(true);
    } finally {
      stop();
    }
  });
});
