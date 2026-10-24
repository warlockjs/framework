import type { RequestLogFilter, RequestLogRecord, RequestLogSummary } from "@warlock.js/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createCollector } from "../src/collector";
import { mountDevtoolsRoutes } from "../src/server/index";
import type { DevtoolsRequestLogSource, MountDevtoolsRoutesDeps } from "../src/server/types";

const options = { path: "/__warlock", maxRequests: 200, nPlusOneThreshold: 5 };
const base = "/__warlock/api/requests";

function record(id: string, overrides: Partial<RequestLogRecord> = {}): RequestLogRecord {
  return {
    type: "request",
    id,
    traceId: id,
    time: new Date(Date.now() - 60_000).toISOString(),
    method: "GET",
    url: "/old",
    route: { pattern: "/old" },
    status: 200,
    durationMs: 3,
    response: {},
    ...overrides,
  };
}

/** A request log source over an array, the way core's reader answers. */
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
  const compile = (filter: RequestLogFilter) => {
    if (filter.status === "bad") throw new Error('Invalid status filter "bad"');

    return (row: RequestLogSummary) =>
      (filter.status === undefined ||
        (String(filter.status).endsWith("xx")
          ? Math.floor(row.status / 100) === Number(String(filter.status)[0])
          : row.status === Number(filter.status))) &&
      (filter.q === undefined || row.url.includes(filter.q) || row.id.includes(filter.q));
  };

  return {
    compile,
    list: async (filter) => records.map(rowOf).filter(compile(filter)).reverse().slice(0, filter.limit),
    get: async (id) => records.find((entry) => entry.id === id),
    curl: (entry, baseUrl) => `curl -X ${entry.method} '${baseUrl}${entry.url}'`,
  };
}

function build(requestLog?: DevtoolsRequestLogSource) {
  const collector = createCollector(options);
  const deps: MountDevtoolsRoutesDeps = {
    collector,
    options,
    isDevelopment: () => true,
    requestLog,
  };
  const server = Fastify();

  mountDevtoolsRoutes(server, deps);

  return { server, collector };
}

function get(server: ReturnType<typeof build>["server"], url: string) {
  return server.inject({ method: "GET", url, remoteAddress: "127.0.0.1", headers: { host: "localhost:2030" } });
}

function liveRequest(collector: ReturnType<typeof build>["collector"], id: string, status: number) {
  collector.startRequest({ id, method: "GET", path: "/live", route: "/live", startedAt: Date.now() });
  collector.endRequest(id, { status, durationMs: 4 });
}

describe("GET /api/requests with a persisted request log", () => {
  it("merges the ring buffer with the log without duplicates", async () => {
    const { server, collector } = build(
      fakeRequestLog([record("old-1"), record("shared"), record("old-2")]),
    );

    liveRequest(collector, "shared", 200);
    liveRequest(collector, "fresh", 200);

    const rows = (await get(server, base)).json() as Array<{ id: string; persisted?: boolean; path: string }>;

    expect(rows.map((row) => row.id).sort()).toEqual(["fresh", "old-1", "old-2", "shared"]);
    expect(rows.find((row) => row.id === "shared")).toMatchObject({ path: "/live" });
    expect(rows.find((row) => row.id === "shared")?.persisted).toBeUndefined();
    expect(rows.find((row) => row.id === "old-1")?.persisted).toBe(true);
  });

  it("filters the live requests and the log alike", async () => {
    const { server, collector } = build(
      fakeRequestLog([record("old-ok"), record("old-500", { status: 500 })]),
    );

    liveRequest(collector, "live-500", 503);
    liveRequest(collector, "live-ok", 200);

    const rows = (await get(server, `${base}?status=5xx`)).json() as Array<{ id: string }>;

    expect(rows.map((row) => row.id).sort()).toEqual(["live-500", "old-500"]);

    const searched = (await get(server, `${base}?q=old-ok`)).json() as Array<{ id: string }>;

    expect(searched.map((row) => row.id)).toEqual(["old-ok"]);
  });

  it("answers 400 for a bad filter", async () => {
    const { server } = build(fakeRequestLog([]));
    const response = await get(server, `${base}?status=bad`);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("Invalid status filter") });
  });

  it("is the in-memory list when there is no persisted log", async () => {
    const { server, collector } = build();

    liveRequest(collector, "only", 200);

    expect(((await get(server, base)).json() as Array<{ id: string }>).map((row) => row.id)).toEqual(["only"]);
  });
});

describe("GET /api/requests/:id", () => {
  it("opens a persisted request after a restart, with its error, logs and queries", async () => {
    const { server } = build(
      fakeRequestLog([
        record("boom", {
          status: 500,
          error: { message: "db down", name: "Error", stack: "Error: db down" },
          logs: [{ level: "error", module: "http", action: "request-error", message: "db down", at: 1 }],
          queries: { count: 3, nPlusOne: [{ query: "select ?", count: 3 }] },
        }),
      ]),
    );

    const detail = (await get(server, `${base}/boom`)).json();

    expect(detail).toMatchObject({
      id: "boom",
      persisted: true,
      error: "db down",
      logs: [{ message: "db down" }],
      record: { error: { stack: "Error: db down" }, queries: { count: 3 } },
    });
  });

  it("adds the persisted record to an in-memory request", async () => {
    const { server, collector } = build(fakeRequestLog([record("both", { body: { a: 1 } })]));

    liveRequest(collector, "both", 200);

    const detail = (await get(server, `${base}/both`)).json();

    expect(detail).toMatchObject({ id: "both", path: "/live", record: { body: { a: 1 } } });
    expect(detail.persisted).toBeUndefined();
  });

  it("answers 404 for an unknown id", async () => {
    const { server } = build(fakeRequestLog([]));

    expect((await get(server, `${base}/nope`)).statusCode).toBe(404);
  });
});

describe("GET /api/requests/:id/curl", () => {
  it("builds curl from the persisted record", async () => {
    const { server } = build(fakeRequestLog([record("a", { method: "POST", url: "/old?x=1" })]));
    const response = await get(server, `${base}/a/curl`);

    expect(response.json()).toEqual({ curl: "curl -X POST 'http://localhost:2030/old?x=1'" });
  });

  it("falls back to the method and path of a live request", async () => {
    const { server, collector } = build();

    liveRequest(collector, "live", 200);

    expect((await get(server, `${base}/live/curl`)).json()).toEqual({
      curl: "curl -X GET 'http://localhost:2030/live'",
    });
    expect((await get(server, `${base}/missing/curl`)).statusCode).toBe(404);
  });
});
