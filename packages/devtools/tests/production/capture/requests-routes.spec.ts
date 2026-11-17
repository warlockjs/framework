import type { RequestLogRecord, RequestLogSummary } from "@warlock.js/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createCollector } from "../../../src/collector";
import { DevtoolsApiError } from "../../../src/production/errors";
import { registerShapeExplainRoute } from "../../../src/server/explain-route";
import { registerRequestsRoutes } from "../../../src/server/requests-routes";
import type { DevtoolsRequestLogSource, MountDevtoolsRoutesDeps } from "../../../src/server/types";
import { createEngine, runRequest } from "./helpers";

const options = { path: "/ops", maxRequests: 200, nPlusOneThreshold: 5 };

function record(id: string, overrides: Partial<RequestLogRecord> = {}): RequestLogRecord {
  return {
    type: "request",
    id,
    traceId: id,
    time: new Date(Date.now() - 600_000).toISOString(),
    method: "GET",
    url: "/old",
    route: { pattern: "/old" },
    status: 200,
    durationMs: 3,
    response: {},
    ...overrides,
  };
}

function fakeRequestLog(records: RequestLogRecord[]): DevtoolsRequestLogSource {
  const rowOf = (entry: RequestLogRecord): RequestLogSummary => ({
    id: entry.id,
    time: entry.time,
    method: entry.method,
    url: entry.url,
    route: entry.route.pattern,
    status: entry.status,
    durationMs: entry.durationMs,
  });

  return {
    compile: () => () => true,
    list: async (filter) => records.map(rowOf).slice(0, filter.limit),
    get: async (id) => records.find((entry) => entry.id === id),
    curl: (entry, baseUrl) => `curl -X ${entry.method} '${baseUrl}${entry.url}'`,
  };
}

async function build(requestLog?: DevtoolsRequestLogSource, random = () => 0) {
  const { engine, store } = createEngine({ random, now: Date.now });
  const server = Fastify();
  const deps: MountDevtoolsRoutesDeps = {
    collector: engine.collector,
    options,
    isDevelopment: () => false,
    mode: "production",
    requests: engine.requests,
    explainShape: engine.explain,
    ...(requestLog === undefined ? {} : { requestLog }),
  };

  registerRequestsRoutes(server, deps);
  registerShapeExplainRoute(server, deps);
  await server.ready();

  return { server, engine, store };
}

describe("production request routes", () => {
  it("lists sampled and partial requests, newest first, merged with the request log", async () => {
    const { server, engine } = await build(fakeRequestLog([record("old-1"), record("shared")]));

    runRequest(engine, "shared");
    runRequest(engine, "fresh", { path: "/fresh" });
    await engine.flush();

    const rows = (await server.inject({ method: "GET", url: "/api/requests" })).json() as {
      id: string;
      persisted?: boolean;
      instance?: string;
    }[];

    expect(rows.map((row) => row.id).sort()).toEqual(["fresh", "old-1", "shared"]);
    expect(rows.find((row) => row.id === "shared")?.persisted).toBeUndefined();
    expect(rows.find((row) => row.id === "shared")?.instance).toBe("host:1:abc");
    expect(rows.find((row) => row.id === "old-1")?.persisted).toBe(true);
  });

  it("filters by status, method and route", async () => {
    const { server, engine } = await build();

    runRequest(engine, "ok");
    runRequest(engine, "bad", { status: 500, route: "/boom" });

    const ids = async (query: string) =>
      (
        (await server.inject({ method: "GET", url: `/api/requests?${query}` })).json() as {
          id: string;
        }[]
      ).map((row) => row.id);

    expect(await ids("status=5xx")).toEqual(["bad"]);
    expect(await ids("status=200")).toEqual(["ok"]);
    expect(await ids("route=boom")).toEqual(["bad"]);
    expect(await ids("method=post")).toEqual([]);
    expect(await ids("since=1h")).toHaveLength(2);
  });

  it("answers request.invalid-filter for a bad filter value", async () => {
    const { server } = await build();

    for (const query of ["status=bad", "method=1%3B2", "since=yesterday", "until=nope"]) {
      const response = await server.inject({ method: "GET", url: `/api/requests?${query}` });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "request.invalid-filter" });
      expect(response.json().error).toContain("filter");
    }
  });

  it("opens a sampled request with its redacted timeline and the persisted record", async () => {
    const { server, engine } = await build(fakeRequestLog([record("t1", { body: { a: 1 } })]));

    runRequest(engine, "t1", {
      queries: [{ bindings: ["hunter2"] }],
      phases: [{ name: "handler", durationMs: 3 }],
    });

    const detail = (await server.inject({ method: "GET", url: "/api/requests/t1" })).json();

    expect(detail).toMatchObject({
      id: "t1",
      queries: [{ shape: expect.any(String) }],
      record: { body: { a: 1 } },
    });
    expect(JSON.stringify(detail.queries)).not.toContain("hunter2");
  });

  it("opens a partial request, from the log when it has a record", async () => {
    const { server, engine } = await build(
      fakeRequestLog([
        record("p1", { status: 503, error: { message: "db down", name: "Error", stack: "x" } }),
      ]),
      () => 0.99,
    );

    runRequest(engine, "p1", { status: 503, durationMs: 2000 });
    runRequest(engine, "p2", { status: 500, durationMs: 10 });

    const withLog = (await server.inject({ method: "GET", url: "/api/requests/p1" })).json();
    const without = (await server.inject({ method: "GET", url: "/api/requests/p2" })).json();

    expect(withLog).toMatchObject({
      id: "p1",
      partial: true,
      error: "db down",
      instance: "host:1:abc",
    });
    expect(without).toMatchObject({ id: "p2", partial: true, status: 500 });
    expect(without.phases).toBeUndefined();
  });

  it("answers request.not-found as JSON for a missing id", async () => {
    const { server } = await build(fakeRequestLog([]));

    for (const url of ["/api/requests/nope", "/api/requests/nope/curl"]) {
      const response = await server.inject({ method: "GET", url });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "request.not-found" });
    }
  });

  it("builds curl from the record, else from the method and path", async () => {
    const { server, engine } = await build(
      fakeRequestLog([record("c1", { method: "POST", url: "/old" })]),
    );

    runRequest(engine, "c2", { path: "/it's" });

    const fromLog = (
      await server.inject({
        method: "GET",
        url: "/api/requests/c1/curl",
        headers: { host: "app.test" },
      })
    ).json();
    const fromSample = (
      await server.inject({
        method: "GET",
        url: "/api/requests/c2/curl",
        headers: { host: "app.test" },
      })
    ).json();

    expect(fromLog.curl).toBe("curl -X POST 'http://app.test/old'");
    expect(fromSample.curl).toBe("curl -X GET 'http://app.test/it'\\''s'");
  });

  it("clears samples and memory", async () => {
    const { server, engine, store } = await build();

    runRequest(engine, "x1");
    await engine.flush();

    expect((await server.inject({ method: "DELETE", url: "/api/requests" })).statusCode).toBe(204);
    expect(await store?.samples.list({ limit: 10 })).toEqual([]);
    expect(await engine.requests.list({ limit: 10 })).toEqual([]);
    expect(engine.collector.listRequests()).toEqual([]);
  });

  it("keeps the development routes when no request source is set", async () => {
    const collector = createCollector(options);
    const server = Fastify();

    registerRequestsRoutes(server, { collector, options, isDevelopment: () => true });
    collector.startRequest({ id: "d", method: "GET", path: "/d", startedAt: 1 });
    collector.endRequest("d", { status: 200, durationMs: 1 });

    expect(
      (
        (await server.inject({ method: "GET", url: "/api/requests" })).json() as { id: string }[]
      ).map((row) => row.id),
    ).toEqual(["d"]);
    expect((await server.inject({ method: "GET", url: "/api/requests/none" })).statusCode).toBe(
      404,
    );
  });
});

describe("POST /api/queries/:shapeId/explain", () => {
  it("answers the plan for an example kept by this process", async () => {
    const run = vi.fn(async () => [{ "QUERY PLAN": [] }]);
    const { engine } = createEngine({ run });
    const server = Fastify();

    runRequest(engine, "e1", { queries: [{ durationMs: 30 }] });

    registerShapeExplainRoute(server, {
      collector: engine.collector,
      options,
      isDevelopment: () => false,
      explainShape: engine.explain,
    });

    const [shape] = engine.queries.snapshot(1);
    const response = await server.inject({
      method: "POST",
      url: `/api/queries/${shape?.id}/explain`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      shapeId: shape?.id,
      executing: false,
      instance: "host:1:abc",
    });
  });

  it("answers the error code, status and instance", async () => {
    const { server } = await build();
    const response = await server.inject({
      method: "POST",
      url: "/api/queries/0123456789abcdef/explain",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: new DevtoolsApiError("explain.elsewhere").message,
      code: "explain.elsewhere",
      instance: "host:1:abc",
    });
  });

  it("answers server.error with a reference for an unexpected failure", async () => {
    const server = Fastify();

    registerShapeExplainRoute(server, {
      collector: createCollector(options),
      options,
      isDevelopment: () => false,
      explainShape: async () => {
        throw new Error("secret detail");
      },
    });

    const response = await server.inject({ method: "POST", url: "/api/queries/abc/explain" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: "server.error", ref: expect.any(String) });
    expect(response.body).not.toContain("secret detail");
  });
});
