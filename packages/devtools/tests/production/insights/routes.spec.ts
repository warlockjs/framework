import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createCollector } from "../../../src/collector";
import { createLocalInsights, createSharedInsights } from "../../../src/production/insights";
import { DevtoolsApiError } from "../../../src/production/errors";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import { registerInsightsRoutes } from "../../../src/server/insights-routes";
import { registerLogRoutes } from "../../../src/server/log-routes";
import type { MountDevtoolsRoutesDeps } from "../../../src/server/types";
import { fakeReporter, logEntry, report, route, shape } from "./helpers";

const collectorOptions = { path: "/__warlock", maxRequests: 10, nPlusOneThreshold: 5 };
let server: FastifyInstance;

async function build(deps: Partial<MountDevtoolsRoutesDeps>) {
  server = Fastify();
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof DevtoolsApiError) return reply.status(error.statusCode).send(error.toBody());

    return reply.status(500).send({ error: error.message });
  });
  const full = { collector: createCollector(collectorOptions), ...deps } as MountDevtoolsRoutesDeps;

  registerInsightsRoutes(server, full);
  registerLogRoutes(server, full);
  await server.ready();

  return server;
}

const NOW = Date.now();
const reporter = fakeReporter("a", () =>
  report("a", NOW, {
    queries: [shape("q1", [10, 20]), shape("q2", [1])],
    routes: [route("GET /a", [10])],
    logs: [logEntry(NOW, "error", "db"), logEntry(NOW - 10, "warn", "http")],
  }),
);

afterEach(async () => {
  await server?.close();
});

describe("insights routes (production, shared)", () => {
  async function shared() {
    const store = createMemoryStore();

    await store.reports.write(report("b", NOW - 1000, { queries: [shape("q9", [900])] }));

    return build({ insights: createSharedInsights({ store, reporter, sampleRate: 0.1 }) });
  }

  it("serves every view as no-store JSON", async () => {
    const app = await shared();

    for (const path of ["instances", "resources", "queries/stats", "routes/stats", "health", "errors", "jobs"]) {
      const response = await app.inject({ method: "GET", url: `/api/${path}` });

      expect(response.statusCode, path).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("merges instances and honours instance, sort and limit", async () => {
    const app = await shared();
    const all = (await app.inject({ url: "/api/queries/stats?limit=2" })).json();
    const one = (await app.inject({ url: "/api/queries/stats?instance=b&sort=count" })).json();

    expect(all.shapes.map((s: { id: string }) => s.id)).toEqual(["q9", "q1"]);
    expect(all.instanceCount).toBe(2);
    expect(one.shapes.map((s: { id: string }) => s.id)).toEqual(["q9"]);
  });

  it("rejects a bad sort or limit with input.invalid", async () => {
    const app = await shared();

    for (const url of [
      "/api/queries/stats?sort=errors",
      "/api/routes/stats?sort=n%2B1",
      "/api/queries/stats?limit=0",
      "/api/queries/stats?limit=501",
      "/api/routes/stats?limit=abc",
      "/api/errors?limit=1.5",
    ]) {
      const response = await app.inject({ url });

      expect(response.statusCode, url).toBe(422);
      expect(response.json().code, url).toBe("input.invalid");
    }
  });

  it("answers logs from every instance, filtered", async () => {
    const app = await shared();
    const rows = (await app.inject({ url: "/api/logs?level=error" })).json();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: "db", instance: "a" });
    expect((await app.inject({ url: "/api/logs?module=HTTP" })).json()).toHaveLength(1);
  });
});

describe("insights routes (development, local)", () => {
  it("serves this process only", async () => {
    const app = await build({ insights: createLocalInsights(reporter) });
    const view = (await app.inject({ url: "/api/instances" })).json();

    expect(view.instances).toHaveLength(1);
    expect((await app.inject({ url: "/api/routes/stats?sort=errors" })).statusCode).toBe(200);
  });
});

describe("without insights", () => {
  it("registers no insights routes and keeps the 5.55 logs", async () => {
    const collector = createCollector(collectorOptions);

    collector.addLog(undefined, { level: "warn", module: "m", action: "a", message: "hi", at: 1, context: { a: 1 } });
    collector.addLog(undefined, { level: "info", module: "n", action: "a", message: "yo", at: 2 });
    const app = await build({ collector });

    expect((await app.inject({ url: "/api/instances" })).statusCode).toBe(404);

    const rows = (await app.inject({ url: "/api/logs?level=warn" })).json();

    expect(rows).toEqual([
      { level: "warn", module: "m", action: "a", message: "hi", at: 1, requestId: null, instance: null, context: { a: 1 } },
    ]);
    expect((await app.inject({ url: "/api/logs?module=n" })).json()).toHaveLength(1);
  });
});
