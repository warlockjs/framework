import type { HttpContext, Middleware } from "@warlock.js/core";
import { t } from "@warlock.js/core";
// Not a queue dependency — reused from core's install so the test server can
// parse cookies the way the real `getHttpServer()` does (core registers this
// plugin itself; see `core/src/http/plugins.ts`). Without it Fastify never
// populates `request.cookies` and the cookie surface can't be exercised.
import fastifyCookie from "../../core/node_modules/@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { closeQueue, queueDashboard, setQueueConfig } from "../src";
import { testQueueConfig } from "./test-redis";

const VALID_TOKEN = "let-me-in";

type GuardPayload = { error: string; errorCode: string };

/**
 * A guard shaped like `authMiddleware` (`auth/src/middleware/auth.middleware.ts`),
 * touching the exact surfaces the bare `Request`/`Response` pair built by
 * `runDashboardMiddleware` may not support: the header credential accessor,
 * `request.cookie`, the optional `request.route` (there is no `Route` here),
 * `request.locals`, `t()` outside a request store, and `response.unauthorized`
 * as the short-circuit.
 */
function buildGuard(): Middleware {
  const guard = async ({ request, response }: HttpContext) => {
    const credential = request.authorizationValue || request.cookie("token") || "";
    const isPage = request.route?.isPage;

    if (credential !== VALID_TOKEN) {
      request.locals.user = undefined;

      const payload: GuardPayload = {
        error: t("auth.errors.invalidAccessToken"),
        errorCode: isPage ? "PAGE_UNAUTHORIZED" : "DASHBOARD_UNAUTHORIZED",
      };

      return response.unauthorized(payload);
    }

    request.locals.user = { id: 1 };

    return undefined;
  };

  return guard;
}

describe("a guard middleware running on the bull-board dashboard over real HTTP", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    await closeQueue();
  });

  async function bootGuardedDashboard(): Promise<void> {
    setQueueConfig(testQueueConfig());

    server = Fastify();
    await server.register(fastifyCookie);
    await queueDashboard(server, { basePath: "/admin/queues", middleware: [buildGuard()] });
    await server.listen({ port: 0, host: "127.0.0.1" });

    const address = server.server.address();

    if (address === null || typeof address === "string") {
      throw new Error("expected a listening TCP socket with an assigned port");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  it("rejects a request with no credential with the guard's own 401 payload", async () => {
    await bootGuardedDashboard();

    const response = await fetch(`${baseUrl}/admin/queues`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: expect.any(String),
      errorCode: "DASHBOARD_UNAUTHORIZED",
    });
  });

  it("rejects a wrong credential", async () => {
    await bootGuardedDashboard();

    const response = await fetch(`${baseUrl}/admin/queues`, {
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(response.status).toBe(401);
  });

  it("lets a right credential in the Authorization header through to bull-board's own handler", async () => {
    await bootGuardedDashboard();

    const response = await fetch(`${baseUrl}/admin/queues`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });

  it("lets a right credential in a cookie through, proving request.cookie works on the bare Request", async () => {
    await bootGuardedDashboard();

    const response = await fetch(`${baseUrl}/admin/queues`, {
      headers: { cookie: `token=${VALID_TOKEN}` },
    });

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });

  it("rejects a second dashboard route with no credential, proving the guard covers every route", async () => {
    await bootGuardedDashboard();

    const response = await fetch(`${baseUrl}/admin/queues/api/queues`);

    expect(response.status).toBe(401);
  });
});
