import { describe, expect, it, vi } from "vitest";
import {
  createErrorGroups,
  createQueryStats,
  createRecentLogs,
  createRouteStats,
} from "../../../src/production/capture";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import type { DevtoolsStore } from "../../../src/production/store/types";
import { createEngine, queryEvent, runRequest, traced } from "./helpers";

const observation = (shape: string, at = 1) => ({
  shape,
  driver: "postgres" as const,
  connection: "default",
  durationMs: 1,
  failed: false,
  at,
  route: null,
  requestId: null,
});

describe("statistics bounds", () => {
  it("evicts the least recently seen shape and counts it", () => {
    const stats = createQueryStats({ maxShapes: 3, instance: "i" });

    for (const name of ["a", "b", "c"]) stats.record(observation(`SELECT ${name}`));

    stats.record(observation("SELECT a")); // a is the most recent now
    stats.record(observation("SELECT d")); // evicts b

    expect(
      stats
        .snapshot(10)
        .map((shape) => shape.shape)
        .sort(),
    ).toEqual(["SELECT a", "SELECT c", "SELECT d"]);
    expect(stats.evicted()).toBe(1);
  });

  it("evicts routes and error groups the same way", () => {
    const routes = createRouteStats({ maxRoutes: 2, instance: "i" });
    const errors = createErrorGroups({ maxGroups: 2 });

    for (const route of ["/a", "/b", "/c"]) {
      routes.record({
        method: "GET",
        route,
        status: 200,
        failed: false,
        durationMs: 1,
        at: 1,
        requestId: null,
        phases: [],
      });
      errors.record({
        source: "request",
        message: `fail ${route}x`,
        name: null,
        stack: null,
        route,
        status: 500,
        requestId: null,
        at: 1,
      });
    }

    expect(routes.snapshot(10)).toHaveLength(2);
    expect(routes.evicted()).toBe(1);
    expect(errors.snapshot(10)).toHaveLength(2);
    expect(errors.evicted()).toBe(1);
  });

  it("keeps at most 30 phases per route and limits what a snapshot returns", () => {
    const routes = createRouteStats({ maxRoutes: 10, instance: "i" });
    const phases = Array.from({ length: 45 }, (_, index) => ({
      name: `p${index}`,
      durationMs: index + 1,
    }));

    routes.record({
      method: "GET",
      route: "/a",
      status: 200,
      failed: false,
      durationMs: 1,
      at: 1,
      requestId: null,
      phases,
    });

    expect(routes.snapshot(10)[0]?.phases).toHaveLength(30);
    expect(routes.snapshot(10)[0]?.phases[0]?.name).toBe("p44");
    expect(routes.snapshot(0)).toEqual([]);
  });

  it("keeps recent logs bounded, newest first, filterable", () => {
    const logs = createRecentLogs({ maxEntries: 3 });

    for (let index = 1; index <= 5; index++) {
      logs.record({
        level: index % 2 ? "warn" : "error",
        module: index > 3 ? "Mail" : "app",
        action: "a",
        message: `m${index}`,
        at: index,
        requestId: null,
      });
    }

    expect(logs.snapshot(10).map((entry) => entry.message)).toEqual(["m5", "m4", "m3"]);
    expect(logs.snapshot(10, { level: "error" }).map((entry) => entry.message)).toEqual(["m4"]);
    expect(logs.snapshot(10, { module: "mail" }).map((entry) => entry.message)).toEqual([
      "m5",
      "m4",
    ]);
  });

  it("truncates long messages and stacks", () => {
    const errors = createErrorGroups({ maxGroups: 5 });
    const logs = createRecentLogs({ maxEntries: 5 });

    errors.record({
      source: "request",
      message: "x".repeat(900),
      name: null,
      stack: "s".repeat(9000),
      route: null,
      status: 500,
      requestId: null,
      at: 1,
    });
    logs.record({
      level: "warn",
      module: "a",
      action: "b",
      message: "y".repeat(3000),
      at: 1,
      requestId: null,
    });

    expect(errors.snapshot(1)[0]?.message).toHaveLength(500);
    expect(errors.snapshot(1)[0]?.stack).toHaveLength(4000);
    expect(logs.snapshot(1)[0]?.message).toHaveLength(1000);
  });
});

describe("per request limits", () => {
  it("keeps 200 queries per sampled request and counts the rest", async () => {
    const { engine, store } = createEngine({ production: { maxQueriesPerRequest: 200 } });
    const request = traced("many");

    engine.hooks.onRequestStart(request);

    for (let index = 0; index < 230; index++) engine.hooks.onQuery("many", queryEvent());

    engine.hooks.onRequestEnd(request, { status: 200, durationMs: 5 });
    await engine.flush();

    const stored = await store?.samples.get("many");

    expect(stored?.detail?.queries).toHaveLength(200);
    expect(stored?.detail?.droppedQueries).toBe(30);
    expect(stored?.summary.queryCount).toBe(230);
    expect(engine.counters().droppedQueries).toBe(30);
  });

  it("keeps 50 logs and 100 phases per sampled request", async () => {
    const { engine, store } = createEngine();
    const request = traced("busy");

    engine.hooks.onRequestStart(request);

    for (let index = 0; index < 70; index++) {
      engine.hooks.onLog("busy", {
        level: "info",
        module: "m",
        action: "a",
        message: `l${index}`,
        at: index,
      });
    }

    for (let index = 0; index < 130; index++)
      engine.hooks.onPhase(request, { name: `p${index}`, durationMs: 1 });

    engine.hooks.onRequestEnd(request, { status: 200, durationMs: 5 });
    await engine.flush();

    const stored = await store?.samples.get("busy");

    expect(stored?.detail?.logs).toHaveLength(50);
    expect(stored?.detail?.phases).toHaveLength(100);
  });

  it("keeps the ring at production.maxRequests", () => {
    const { engine } = createEngine({ production: { maxRequests: 5 } });

    for (let index = 0; index < 12; index++) runRequest(engine, `r${index}`);

    expect(engine.collector.listRequests()).toHaveLength(5);
  });

  it("reports evictions in the counters", () => {
    const { engine } = createEngine({ production: { maxShapes: 2, maxRoutes: 2 } });

    for (let index = 0; index < 4; index++) {
      runRequest(engine, `r${index}`, {
        route: `/r${index}`,
        queries: [{ sql: `SELECT col${index} FROM t` }],
      });
    }

    expect(engine.counters()).toMatchObject({ evictedShapes: 2, evictedRoutes: 2 });
  });
});

describe("sample writer", () => {
  it("stops writing at the per-minute budget and counts the rest", async () => {
    const { engine, store, clock } = createEngine({ production: { maxStoredSamplesPerMinute: 5 } });

    for (let index = 0; index < 8; index++) runRequest(engine, `b${index}`);

    await engine.flush();

    expect(await store?.samples.list({ limit: 100 })).toHaveLength(5);
    expect(engine.counters()).toMatchObject({ stored: 5, droppedStored: 3 });

    // The dropped ones are still in this process's memory.
    expect(await engine.requests.list({ limit: 100 })).toHaveLength(8);

    clock.advance(60_000);
    runRequest(engine, "next-minute");
    await engine.flush();

    expect(await store?.samples.get("next-minute")).not.toBeNull();
  });

  it("flushes at 50 pending samples", async () => {
    const insert = vi.fn(async () => {});
    const store = createMemoryStore();
    const wrapped: DevtoolsStore = { ...store, samples: { ...store.samples, insert } };
    const { engine } = createEngine({
      store: wrapped,
      production: { maxStoredSamplesPerMinute: 1000 },
    });

    for (let index = 0; index < 49; index++) runRequest(engine, `f${index}`);

    expect(insert).not.toHaveBeenCalled();

    runRequest(engine, "f49");

    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0]?.[0]).toHaveLength(50);
  });

  it("flushes every 5 seconds once started", async () => {
    vi.useFakeTimers();

    try {
      const { engine, store } = createEngine();

      engine.startWriter();
      runRequest(engine, "timed");

      expect(await store?.samples.get("timed")).toBeNull();

      await vi.advanceTimersByTimeAsync(5000);

      expect(await store?.samples.get("timed")).not.toBeNull();
      engine.stopWriter();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the oldest samples past 500 queued", async () => {
    const insert = vi.fn(async () => {});
    const store = createMemoryStore();
    const wrapped: DevtoolsStore = { ...store, samples: { ...store.samples, insert } };
    const { engine } = createEngine({
      store: wrapped,
      production: { maxStoredSamplesPerMinute: 100_000, maxRequests: 10 },
    });

    // Writes are asynchronous, so a burst in one tick queues up behind the writer.
    for (let index = 0; index < 520; index++) runRequest(engine, `q${index}`);

    await engine.flush();

    const written = insert.mock.calls.flatMap((call) => call[0] as { id: string }[]);

    expect(engine.counters().droppedStored).toBe(20);
    expect(written).toHaveLength(500);
    expect(written[0]?.id).toBe("q20");
  });

  it("logs a store failure once a minute and drops the batch", async () => {
    const store = createMemoryStore();
    const failing: DevtoolsStore = {
      ...store,
      samples: {
        ...store.samples,
        insert: async () => {
          throw new Error("db down");
        },
      },
    };
    const { engine, clock, warnings } = createEngine({ store: failing });

    runRequest(engine, "e1");
    await engine.flush();
    runRequest(engine, "e2");
    await engine.flush();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("db down");
    expect(engine.counters()).toMatchObject({ stored: 0, droppedStored: 2 });

    clock.advance(61_000);
    runRequest(engine, "e3");
    await engine.flush();

    expect(warnings).toHaveLength(2);
  });

  it("keeps samples in memory only without a store", async () => {
    const { engine } = createEngine({ store: null });

    runRequest(engine, "mem");
    await engine.flush();

    expect((await engine.requests.list({ limit: 5 })).map((row) => row.id)).toEqual(["mem"]);
    expect(await engine.requests.clear()).toBe(1);
    expect(await engine.requests.list({ limit: 5 })).toEqual([]);
  });
});
