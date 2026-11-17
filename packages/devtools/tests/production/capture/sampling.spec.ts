import {
  dispatchPhase,
  dispatchRequestEnd,
  dispatchRequestStart,
  resetTracingConfigForTests,
  type TracingContext,
} from "@warlock.js/core";
import { dataSourceRegistry } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createProductionCapture } from "../../../src/production/capture";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import { createEngine, instance, productionOptions, queryEvent, runRequest, SECRET, traced } from "./helpers";

/** A random source that returns the scripted values, then 0.99 (never sampled at 0.1). */
function script(...values: number[]) {
  const queue = [...values];

  return () => queue.shift() ?? 0.99;
}

describe("sampling", () => {
  it("samples about sampleRate of the requests with a seeded random source", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;

      return seed / 4294967296;
    };
    const { engine } = createEngine({ random, production: { sampleRate: 0.1 }, store: null });

    for (let index = 0; index < 5000; index++) runRequest(engine, `r${index}`);

    const counters = engine.counters();

    expect(counters.requests).toBe(5000);
    expect(counters.sampled).toBeGreaterThan(400);
    expect(counters.sampled).toBeLessThan(600);
  });

  it("samples every request at 1 and none at 0", () => {
    const always = createEngine({ production: { sampleRate: 1 }, random: () => 0.999, store: null });
    const never = createEngine({ production: { sampleRate: 0 }, random: () => 0, store: null });

    for (let index = 0; index < 20; index++) {
      runRequest(always.engine, `a${index}`);
      runRequest(never.engine, `n${index}`);
    }

    expect(always.engine.counters().sampled).toBe(20);
    expect(never.engine.counters().sampled).toBe(0);
  });

  it("adds nothing to the statistics for an unsampled request", () => {
    const { engine } = createEngine({ random: () => 0.99 });

    runRequest(engine, "quiet", {
      queries: [{ durationMs: 5 }],
      phases: [{ name: "handler", durationMs: 4 }],
    });

    expect(engine.queries.snapshot(10)).toEqual([]);
    expect(engine.routes.snapshot(10)).toEqual([]);
    expect(engine.errors.snapshot(10)).toEqual([]);
    expect(engine.collector.listRequests()).toEqual([]);
    expect(engine.counters()).toMatchObject({ requests: 1, sampled: 0, keptUnsampled: 0 });
  });

  it("keeps a slow unsampled request as a partial summary and records its error", async () => {
    const { engine, store } = createEngine({ random: () => 0.99 });

    runRequest(engine, "slow", { durationMs: 1500, queries: [{ durationMs: 1 }] });
    runRequest(engine, "fail", { status: 503, durationMs: 20, error: new TypeError("db down") });
    runRequest(engine, "fine", { durationMs: 20 });
    await engine.flush();

    const rows = await engine.requests.list({ limit: 10 });
    const partial = await store?.samples.get("slow");

    expect(rows.map((row) => row.id).sort()).toEqual(["fail", "slow"]);
    expect(rows.every((row) => row.partial === true)).toBe(true);
    expect(partial?.detail).toBeNull();
    expect(partial?.summary).toMatchObject({ queryCount: 0, instance: instance.id, partial: true });
    expect(engine.counters().keptUnsampled).toBe(2);
    expect(engine.errors.snapshot(10)).toMatchObject([
      { name: "TypeError", message: "db down", status: 503, source: "request" },
    ]);
    // No statistics for unsampled work.
    expect(engine.routes.snapshot(10)).toEqual([]);
    expect(engine.queries.snapshot(10)).toEqual([]);
  });

  it("records a sampled request in full", async () => {
    const { engine, store } = createEngine({ random: () => 0 });

    runRequest(engine, "full", {
      queries: [{ durationMs: 4 }, { durationMs: 6 }],
      phases: [{ name: "handler", durationMs: 7 }],
    });
    await engine.flush();

    const stored = await store?.samples.get("full");

    expect(stored?.detail?.queries).toHaveLength(2);
    expect(stored?.detail?.phases).toHaveLength(1);
    expect(engine.queries.snapshot(10)[0]).toMatchObject({ count: 2 });
    expect(engine.routes.snapshot(10)[0]).toMatchObject({ key: "GET /posts/:id", count: 1 });
  });

  it("lets a slow unsampled query update only its shape's slowest example", () => {
    const { engine } = createEngine({ random: () => 0.99 });
    const request = traced("slowq");

    engine.hooks.onRequestStart(request);
    engine.hooks.onQuery("slowq", queryEvent({ durationMs: 50 }));
    engine.hooks.onQuery("slowq", queryEvent({ durationMs: 400, bindings: [SECRET] }));
    engine.hooks.onRequestEnd(request, { status: 200, durationMs: 450 });

    const [shape] = engine.queries.snapshot(10);

    expect(shape).toMatchObject({ count: 0, slowest: { durationMs: 400, requestId: null } });
    expect(shape?.histogram.count).toBe(0);
    expect(engine.queries.example(shape?.id ?? "")?.bindings).toEqual([SECRET]);
  });

  it("samples background queries one by one at sampleRate", () => {
    const { engine } = createEngine({ random: script(0.05, 0.5, 0.01) });

    for (let index = 0; index < 3; index++) engine.hooks.onQuery(undefined, queryEvent());

    expect(engine.queries.snapshot(10)[0]).toMatchObject({
      count: 2,
      slowest: { route: null, requestId: null },
    });
  });

  it("keeps a slow unsampled background query as an example only", () => {
    const { engine } = createEngine({ random: () => 0.9 });

    engine.hooks.onQuery(undefined, queryEvent({ durationMs: 900 }));

    expect(engine.queries.snapshot(10)[0]).toMatchObject({ count: 0, slowest: { durationMs: 900 } });
  });

  it("never captures the dashboard path", () => {
    const { engine } = createEngine({ production: { sampleRate: 1 }, random: () => 0 });

    runRequest(engine, "dash", { path: "/ops-secret-path/api/requests", durationMs: 5000, status: 500 });

    expect(engine.counters()).toMatchObject({ requests: 0, sampled: 0, keptUnsampled: 0 });
    expect(engine.collector.listRequests()).toEqual([]);
    expect(engine.errors.snapshot(10)).toEqual([]);
  });

  it("never keeps a slow or failed unsampled dashboard request", () => {
    const { engine } = createEngine({ random: () => 0.99 });

    // Start was skipped (dashboard), and the end hook alone must not keep it either.
    engine.hooks.onRequestEnd(traced("dash2", "/ops-secret-path/"), {
      status: 500,
      durationMs: 9000,
    });

    expect(engine.counters().keptUnsampled).toBe(0);
  });

  it("ignores log lines below logLevels outside a sampled request", () => {
    const { engine } = createEngine({ random: () => 0.99 });

    engine.hooks.onLog(undefined, { level: "info", module: "app", action: "x", message: "hi", at: 1 });
    engine.hooks.onLog(undefined, { level: "warn", module: "app", action: "x", message: "careful", at: 2 });
    engine.hooks.onLog(undefined, { level: "error", module: "app", action: "x", message: "failed 42", at: 3 });

    expect(engine.logs.snapshot(10).map((entry) => entry.message)).toEqual(["failed 42", "careful"]);
    expect(engine.errors.snapshot(10)).toMatchObject([{ source: "log", message: "failed 42" }]);
  });
});

describe("registration with core, cascade and the logger", () => {
  afterEach(() => resetTracingConfigForTests());

  it("captures a request, its queries and its logs through the real sources, and stops after dispose", async () => {
    resetTracingConfigForTests();

    const capture = createProductionCapture({
      options: { path: "/ops-secret-path", maxRequests: 200, nPlusOneThreshold: 5 },
      production: productionOptions({ sampleRate: 1 }),
      instance,
      store: createMemoryStore(),
      isDashboardPath: (path) => path.startsWith("/ops-secret-path"),
      random: () => 0,
      warn: () => {},
    });
    const dispose = await capture.attach();
    const driver = new EventEmitter() as unknown as { on: unknown; off: unknown; emit: (...a: unknown[]) => void };
    const source = dataSourceRegistry.register({ name: "capture-test", driver: driver as never });
    const ctx: TracingContext = {
      traceId: "t1",
      requestId: "real-1",
      method: "GET",
      route: "/things/:id",
      path: "/things/42",
    };

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "handler", durationMs: 3, startedAt: 10, attrs: { secret: SECRET } });
    // No request context here, so the query is background work: it is sampled at 1.
    driver.emit("query", { driver: "postgres", sql: "SELECT 1", startedAt: 1, durationMs: 2 });
    await log.error("capture-test", "boom", "it failed", { password: SECRET });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 9 });
    await capture.flush();

    expect(capture.counters()).toMatchObject({ requests: 1, sampled: 1 });
    expect(capture.routes.snapshot(5)[0]).toMatchObject({ key: "GET /things/:id" });
    expect(capture.queries.snapshot(5)[0]).toMatchObject({ shape: "SELECT ?", count: 1 });
    expect(capture.logs.snapshot(5)[0]).toMatchObject({ module: "capture-test", level: "error" });
    expect(JSON.stringify(await capture.requests.get("real-1"))).not.toContain(SECRET);
    expect(JSON.stringify(capture.logs.snapshot(5))).not.toContain(SECRET);

    await capture.dispose();

    dispatchRequestStart({ ...ctx, requestId: "real-2" });
    dispatchRequestEnd({ ...ctx, requestId: "real-2" }, { status: 200, durationMs: 9 });
    await log.error("capture-test", "boom", "after dispose");

    expect(capture.counters().requests).toBe(1);
    expect(capture.logs.snapshot(5)).toHaveLength(1);
    dispose();
    dataSourceRegistry.unregister(source);
  });
});
