import { describe, expect, it } from "vitest";
import {
  attachDevelopmentStats,
  createErrorGroups,
  createQueryStats,
  createRecentLogs,
  createRouteStats,
} from "../../../src/production/capture";
import { normalizeErrorMessage } from "../../../src/production/capture/stats-stores";
import {
  histogramQuantile,
  mergeQueryShapeStats,
  mergeRouteStats,
  shortId,
} from "../../../src/production/stats";
import { createCollector } from "../../../src/collector";
import { createEngine, runRequest } from "./helpers";

const observation = (durationMs: number, overrides = {}) => ({
  shape: "SELECT * FROM posts WHERE id = ?",
  driver: "postgres" as const,
  connection: "default",
  durationMs,
  failed: false,
  at: 100,
  route: "/posts/:id",
  requestId: "r1",
  ...overrides,
});

describe("query statistics", () => {
  it("counts, errors, quantiles and slowest per shape", () => {
    const stats = createQueryStats({ maxShapes: 10, instance: "i1" });

    for (const duration of [1, 2, 3, 4, 5, 6, 7, 8, 9, 40]) stats.record(observation(duration));

    stats.record(observation(2, { failed: true }));

    const [shape] = stats.snapshot(10);

    expect(shape).toMatchObject({
      id: shortId("SELECT * FROM posts WHERE id = ?"),
      count: 11,
      errors: 1,
      explainable: true,
      slowest: { durationMs: 40, route: "/posts/:id", requestId: "r1", instance: "i1" },
    });
    expect(shape && histogramQuantile(shape.histogram, 0.5)).toBe(5);
    expect(shape && histogramQuantile(shape.histogram, 0.99)).toBe(40);
  });

  it("orders by total time and marks explainable shapes", () => {
    const stats = createQueryStats({ maxShapes: 10, instance: "i1" });

    stats.record(observation(5, { shape: "SELECT a" }));
    stats.record(observation(90, { shape: "INSERT INTO t VALUES (?)" }));
    stats.record(observation(1, { shape: "users.find {}", driver: "mongodb" }));
    stats.record(observation(1, { shape: "app.users.insertOne {}", driver: "mongodb" }));
    stats.record(observation(1, { shape: "-- hi\nWITH x AS (SELECT 1) SELECT * FROM x" }));

    const rows = stats.snapshot(10);

    expect(rows[0]?.shape).toBe("INSERT INTO t VALUES (?)");
    expect(Object.fromEntries(rows.map((row) => [row.shape, row.explainable]))).toMatchObject({
      "INSERT INTO t VALUES (?)": false,
      "SELECT a": true,
      "users.find {}": true,
      "app.users.insertOne {}": false,
    });
    expect(rows.find((row) => row.shape.startsWith("-- hi"))?.explainable).toBe(true);
    expect(stats.snapshot(2)).toHaveLength(2);
  });

  it("counts N+1 requests and the highest count", () => {
    const stats = createQueryStats({ maxShapes: 10, instance: "i1" });

    stats.record(observation(1));
    stats.recordNPlusOne("SELECT * FROM posts WHERE id = ?", 7);
    stats.recordNPlusOne("SELECT * FROM posts WHERE id = ?", 12);
    stats.recordNPlusOne("SELECT * FROM posts WHERE id = ?", 5);

    expect(stats.snapshot(1)[0]?.nPlusOne).toEqual({ requests: 3, maxPerRequest: 12 });
  });

  it("shows N+1 from a sampled request through the capture", () => {
    const { engine } = createEngine({ random: () => 0 });

    runRequest(engine, "n1", {
      queries: Array.from({ length: 6 }, (_, index) => ({ sql: "SELECT * FROM t WHERE id = $1", bindings: [index] })),
    });

    expect(engine.queries.snapshot(1)[0]).toMatchObject({
      count: 6,
      nPlusOne: { requests: 1, maxPerRequest: 6 },
    });
  });

  it("rememberExample keeps the slowest example and updates slowest", () => {
    const stats = createQueryStats({ maxShapes: 10, instance: "i1" });
    const base = {
      id: "q1",
      connection: "default",
      driver: "postgres" as const,
      sql: "SELECT 1",
      shape: "SELECT ?",
      startedAt: 5,
    };

    stats.rememberExample({ ...base, durationMs: 10, bindings: ["a"] });
    stats.rememberExample({ ...base, id: "q2", durationMs: 5, bindings: ["b"] });
    stats.rememberExample({ ...base, id: "q3", durationMs: 30, bindings: ["c"] });

    const id = shortId("SELECT ?");

    expect(stats.example(id)).toMatchObject({ id: "q3", bindings: ["c"] });
    expect(stats.snapshot(1)[0]?.slowest).toMatchObject({ durationMs: 30, route: null });
    expect(stats.example("0000000000000000")).toBeUndefined();

    stats.clear();

    expect(stats.example(id)).toBeUndefined();
  });

  it("merges exactly across instances", () => {
    const first = createQueryStats({ maxShapes: 10, instance: "a" });
    const second = createQueryStats({ maxShapes: 10, instance: "b" });

    first.record(observation(3));
    second.record(observation(300));

    const merged = mergeQueryShapeStats([
      { instance: "a", shapes: first.snapshot(10) },
      { instance: "b", shapes: second.snapshot(10) },
    ]);

    expect(merged[0]).toMatchObject({ count: 2, slowest: { durationMs: 300, instance: "b" } });
  });
});

describe("route statistics", () => {
  const request = (durationMs: number, overrides = {}) => ({
    method: "GET",
    route: "/posts/:id",
    status: 200,
    failed: false,
    durationMs,
    at: 1,
    requestId: "r",
    phases: [
      { name: "handler", durationMs: durationMs / 2 },
      { name: "validation", durationMs: 1 },
    ],
    ...overrides,
  });

  it("counts, errors, phases and slowest", () => {
    const routes = createRouteStats({ maxRoutes: 10, instance: "i1" });

    routes.record(request(10));
    routes.record(request(90, { failed: true, status: 500 }));

    const [route] = routes.snapshot(10);

    expect(route).toMatchObject({
      key: "GET /posts/:id",
      count: 2,
      errors: 1,
      slowest: { durationMs: 90, instance: "i1" },
    });
    expect(route?.phases[0]).toMatchObject({ name: "handler", count: 2, sumMs: 50, maxMs: 45 });
  });

  it("names an unmatched route", () => {
    const routes = createRouteStats({ maxRoutes: 10, instance: "i1" });

    routes.record(request(5, { route: "", status: 404 }));

    expect(routes.snapshot(1)[0]).toMatchObject({ key: "GET (unmatched)", route: "(unmatched)" });
  });

  it("merges across instances", () => {
    const first = createRouteStats({ maxRoutes: 10, instance: "a" });
    const second = createRouteStats({ maxRoutes: 10, instance: "b" });

    first.record(request(10));
    second.record(request(20));

    expect(mergeRouteStats([
        { instance: "a", routes: first.snapshot(5) },
        { instance: "b", routes: second.snapshot(5) },
      ])[0]).toMatchObject({ count: 2 });
  });
});

describe("error groups", () => {
  const error = (message: string, overrides = {}) => ({
    source: "request" as const,
    message,
    name: "Error",
    stack: "Error: x\n    at a",
    route: "/posts/:id",
    status: 500,
    requestId: "r",
    at: 10,
    ...overrides,
  });

  it("groups messages that differ only in numbers, ids, emails and quoted strings", () => {
    const errors = createErrorGroups({ maxGroups: 10 });

    errors.record(error('User 42 "ann" not found for ann@example.com', { at: 1 }));
    errors.record(error('User 977 "bob" not found for bob@example.org', { at: 2, requestId: "last" }));
    errors.record(error("User 3 missing"));

    const groups = errors.snapshot(10);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.count === 2)).toMatchObject({
      message: 'User 977 "bob" not found for bob@example.org',
      firstSeen: 1,
      lastSeen: 2,
      lastRequestId: "last",
    });
  });

  it("separates by route, source and name", () => {
    const errors = createErrorGroups({ maxGroups: 10 });

    errors.record(error("boom"));
    errors.record(error("boom", { route: "/other" }));
    errors.record(error("boom", { source: "log" }));
    errors.record(error("boom", { name: "TypeError" }));

    expect(errors.snapshot(10)).toHaveLength(4);
  });

  it("replaces uuids and hex ids in the fingerprint", () => {
    expect(normalizeErrorMessage("no 3f2b8c1e-0a4d-4f6b-9c1d-2a7e5b8d9f01 or 507f1f77bcf86cd799439011")).toBe(
      "no <uuid> or <hex>",
    );
    expect(normalizeErrorMessage("retry in 2.5s at 0xdeadbeef")).toBe("retry in <n>s at <hex>");
  });

  it("groups lines that carry a request id, such as core's request summary", () => {
    const errors = createErrorGroups({ maxGroups: 10 });

    errors.record(error("Completed Request: R9DyP5UlXSbfpkQvevfulOl6dB64Shua — 500 in 8ms", { source: "log" }));
    errors.record(error("Completed Request: BKmOaSe05kfa70JZ0wfvPFUloNsUcFtF — 500 in 1ms", { source: "log" }));

    expect(errors.snapshot(10)).toHaveLength(1);
    expect(errors.snapshot(1)[0]?.count).toBe(2);
    // A plain word with no digit is not an id.
    expect(normalizeErrorMessage("ConnectionRefusedByUpstream")).toBe("ConnectionRefusedByUpstream");
  });

  it("keeps the previous stack when a later occurrence has none", () => {
    const errors = createErrorGroups({ maxGroups: 10 });

    errors.record(error("boom"));
    errors.record(error("boom", { stack: null }));

    expect(errors.snapshot(1)[0]).toMatchObject({ count: 2, stack: "Error: x\n    at a" });
  });
});

describe("attachDevelopmentStats", () => {
  it("feeds queries, routes, N+1, errors and logs from settled requests", () => {
    const collector = createCollector({ path: "/__warlock", maxRequests: 50, nPlusOneThreshold: 3 });
    const parts = {
      queries: createQueryStats({ maxShapes: 20, instance: "dev" }),
      routes: createRouteStats({ maxRoutes: 20, instance: "dev" }),
      errors: createErrorGroups({ maxGroups: 20 }),
      logs: createRecentLogs({ maxEntries: 20 }),
      nPlusOneThreshold: 3,
    };
    const stop = attachDevelopmentStats(collector, parts);

    collector.startRequest({ id: "d1", method: "GET", path: "/p/1", route: "/p/:id", startedAt: 1 });
    collector.addPhase("d1", { name: "handler", startedAt: 1, durationMs: 4 });

    for (let index = 0; index < 4; index++) {
      collector.addQuery("d1", { connection: "default", driver: "postgres", sql: `SELECT * FROM t WHERE id = ${index}`, startedAt: 2, durationMs: 5 });
    }

    collector.addLog("d1", { level: "info", module: "m", action: "a", message: "ignored", at: 3 });
    collector.addLog("d1", { level: "error", module: "m", action: "a", message: "bad thing", at: 4, context: { token: "x" } });
    collector.endRequest("d1", { status: 500, durationMs: 20, error: "kaput" });

    expect(parts.queries.snapshot(5)[0]).toMatchObject({ count: 4, nPlusOne: { requests: 1, maxPerRequest: 4 } });
    expect(parts.routes.snapshot(5)[0]).toMatchObject({ key: "GET /p/:id", errors: 1 });
    expect(parts.errors.snapshot(5).map((group) => [group.source, group.message]).sort()).toEqual([
      ["log", "bad thing"],
      ["request", "kaput"],
    ]);
    expect(parts.logs.snapshot(5).map((entry) => entry.message)).toEqual(["bad thing"]);
    expect(JSON.stringify(parts.logs.snapshot(5))).not.toContain("token");

    stop();
    collector.startRequest({ id: "d2", method: "GET", path: "/p/2", startedAt: 1 });
    collector.endRequest("d2", { status: 200, durationMs: 1 });

    expect(parts.routes.snapshot(5)).toHaveLength(1);
  });
});
