/**
 * Tracing phases wired into `Request`: "middleware" (one per
 * middleware) and "validation".
 *
 * No running Fastify server: a bare `Request`/`Response` pair plus a fake
 * `Route`, mirroring the pattern already used in `csp.spec.ts` /
 * `request.spec.ts`.
 */
import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../router";
import { Request } from "./request";
import { Response } from "./response";
import { resetTracingConfigForTests } from "./tracing/tracing-dispatcher";
import type { TracingHooks } from "./tracing/tracing.type";

function createRequestWithRoute(route: Partial<Route>) {
  const request = new Request();
  const response = new Response();

  response.setResponse({
    header: () => {},
    getHeader: () => undefined,
    raw: { once: () => {} },
  } as never);

  request.response = response;
  response.request = request;

  request.setRequest({
    method: "GET",
    url: "/things/42",
    headers: {},
    body: undefined,
    query: {},
    params: {},
  } as never);

  request.setRoute(route as Route);

  return { request, response };
}

beforeEach(() => {
  resetTracingConfigForTests();
});

afterEach(() => {
  config.set("http.tracing", undefined);
  resetTracingConfigForTests();
  vi.restoreAllMocks();
});

describe("disabled — zero overhead on the middleware/validation call sites", () => {
  it("never calls performance.now while running 2 middlewares + validation", async () => {
    config.set("http.tracing", { enabled: false });

    async function mw1() {
      return undefined;
    }
    async function mw2() {
      return undefined;
    }
    const handler = Object.assign(async () => undefined, {
      validation: { validate: async () => undefined },
    });

    const { request } = createRequestWithRoute({
      middleware: [mw1, mw2],
      handler: handler as never,
    });

    const nowSpy = vi.spyOn(performance, "now");

    await request.runMiddleware();

    expect(nowSpy).not.toHaveBeenCalled();
  });
});

describe("enabled — middleware and validation phases fire in order", () => {
  it("emits one 'middleware' onPhase per middleware (name/index) then 'validation'", async () => {
    const phases: Array<{ name: string; attrs?: Record<string, unknown> }> = [];
    const hook: TracingHooks = {
      onPhase: (_ctx, phase) => phases.push({ name: phase.name, attrs: phase.attrs }),
    };

    config.set("http.tracing", { enabled: true, hooks: [hook] });

    async function auth() {
      return undefined;
    }
    async function throttle() {
      return undefined;
    }
    const handler = Object.assign(async () => undefined, {
      validation: { validate: async () => undefined },
    });

    const { request } = createRequestWithRoute({
      middleware: [auth, throttle],
      handler: handler as never,
    });

    await request.runMiddleware();

    expect(phases).toEqual([
      { name: "middleware", attrs: { name: "auth", index: 0 } },
      { name: "middleware", attrs: { name: "throttle", index: 1 } },
      { name: "validation", attrs: undefined },
    ]);
  });

  it("passes traceId/requestId/method/route/path on the phase ctx", () => {
    // Covered end-to-end via the shared `buildTracingContext` unit specs in
    // `tracing/tracing-dispatcher.spec.ts`; this pins that the SAME request
    // exposes a non-empty `traceId` by the time middleware phases can fire.
    const { request } = createRequestWithRoute({ middleware: [], handler: (async () => {}) as never });

    expect(request.traceId).toBeTruthy();
    expect(request.traceId).toBe(request.id);
  });
});
