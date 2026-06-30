import type { ReportStatus, Usage } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import type { Trace } from "../contracts/trace.type";
import { createCacheTraceStore } from "./cache-trace-store";

type TraceOverrides = {
  traceId?: string;
  sessionId?: string;
  status?: ReportStatus;
  startedAt?: string;
  usage?: Usage;
  duration?: number;
};

function trace(overrides: TraceOverrides = {}): Trace {
  const traceId = overrides.traceId ?? "run-1";
  const startedAt = overrides.startedAt ?? "2026-06-18T10:00:00.000Z";
  const status = overrides.status ?? "completed";
  const usage = overrides.usage ?? { input: 100, output: 50, total: 150 };
  const duration = overrides.duration ?? 1000;

  return {
    traceId,
    sessionId: overrides.sessionId,
    startedAt,
    endedAt: "2026-06-18T10:00:01.000Z",
    duration,
    usage,
    root: {
      spanId: traceId,
      traceId,
      name: "agent",
      type: "agent",
      status,
      startedAt,
      endedAt: "2026-06-18T10:00:01.000Z",
      duration,
      usage,
      children: [],
    },
  };
}

/**
 * Minimal hand mock of the cache driver surface the store touches
 * (`get` / `set` / `remove`). Backed by a plain `Map`; records calls and
 * lets a test pre-seed entries to simulate a prior run for hydration.
 * Typed loosely on purpose — the store only ever calls these three ops.
 */
function mockDriver(seed: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(seed));

  return {
    storage,
    get: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (storage.has(key) ? (storage.get(key) as T) : null) as T | null;
    }),
    set: vi.fn(async (key: string, value: unknown): Promise<unknown> => {
      storage.set(key, value);

      return value;
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      storage.delete(key);
    }),
  };
}

/** Flush the microtask queue so fire-and-forget write-throughs settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createCacheTraceStore", () => {
  it("serves get synchronously from the in-memory mirror after add", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);

    store.add(trace({ traceId: "t1" }));

    expect(store.size).toBe(1);
    expect(store.get("t1")?.traceId).toBe("t1");
    expect(store.get("missing")).toBeUndefined();
  });

  it("overwrites a trace re-collected under the same id", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);

    store.add(trace({ traceId: "t1", status: "completed" }));
    store.add(trace({ traceId: "t1", status: "failed" }));

    expect(store.size).toBe(1);
    expect(store.get("t1")?.root.status).toBe("failed");
  });

  it("doubles as an exporter via export()", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);

    store.export(trace({ traceId: "t1" }));

    expect(store.name).toBe("cache-trace-store");
    expect(store.get("t1")).toBeDefined();
  });

  it("queries by session and returns newest-started first", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);
    store.add(trace({ traceId: "old", sessionId: "s1", startedAt: "2026-06-18T09:00:00.000Z" }));
    store.add(trace({ traceId: "new", sessionId: "s1", startedAt: "2026-06-18T11:00:00.000Z" }));
    store.add(trace({ traceId: "other", sessionId: "s2", startedAt: "2026-06-18T10:00:00.000Z" }));

    const result = store.query({ sessionId: "s1" });

    expect(result).toHaveLength(2);
    expect(result[0]?.traceId).toBe("new");
    expect(result[1]?.traceId).toBe("old");
  });

  it("returns all traces for an empty query", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);
    store.add(trace({ traceId: "a" }));
    store.add(trace({ traceId: "b" }));

    expect(store.query()).toHaveLength(2);
  });

  it("aggregates usage, cost, status counts, and duration over a slice", () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);
    store.add(
      trace({
        traceId: "a",
        sessionId: "s1",
        status: "completed",
        duration: 1000,
        usage: { input: 100, output: 50, total: 150, cost: { input: 0.01, output: 0.03 } },
      }),
    );
    store.add(
      trace({
        traceId: "b",
        sessionId: "s1",
        status: "failed",
        duration: 500,
        usage: { input: 40, output: 10, total: 50, cost: { input: 0.004, output: 0.006 } },
      }),
    );
    store.add(trace({ traceId: "c", sessionId: "s2", status: "completed" }));

    const stats = store.aggregate({ sessionId: "s1" });

    expect(stats.traces).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(0);
    expect(stats.usage.input).toBe(140);
    expect(stats.usage.total).toBe(200);
    expect(stats.totalDuration).toBe(1500);
    expect(stats.cost?.input).toBeCloseTo(0.014);
    expect(stats.cost?.output).toBeCloseTo(0.036);
  });

  it("writes through each trace + the index to the cache", async () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never, { prefix: "px" });

    store.add(trace({ traceId: "t1" }));
    await flush();

    expect(driver.storage.has("px:trace:t1")).toBe(true);
    const index = driver.storage.get("px:index") as Array<{ id: string }>;
    expect(index.map((entry) => entry.id)).toEqual(["t1"]);
    expect((driver.storage.get("px:trace:t1") as Trace).traceId).toBe("t1");
  });

  it("defaults the key prefix to 'panoptic'", async () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);

    store.add(trace({ traceId: "t1" }));
    await flush();

    expect(driver.storage.has("panoptic:trace:t1")).toBe(true);
    expect(driver.storage.has("panoptic:index")).toBe(true);
  });

  it("resolves a sync driver factory lazily on first use", async () => {
    const driver = mockDriver();
    const factory = vi.fn(() => driver);
    const store = createCacheTraceStore(factory as never);

    // Not resolved until the first write needs it.
    expect(factory).not.toHaveBeenCalled();

    store.add(trace({ traceId: "t1" }));
    await flush();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(driver.storage.has("panoptic:trace:t1")).toBe(true);
  });

  it("resolves an async driver factory lazily and memoizes it", async () => {
    const driver = mockDriver();
    const factory = vi.fn(async () => driver);
    const store = createCacheTraceStore(factory as never);

    expect(factory).not.toHaveBeenCalled();

    store.add(trace({ traceId: "t1" }));
    store.add(trace({ traceId: "t2" }));
    await flush();

    // Resolved exactly once despite two writes — memoized.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(driver.storage.has("panoptic:trace:t1")).toBe(true);
    expect(driver.storage.has("panoptic:trace:t2")).toBe(true);
  });

  it("hydrates the mirror from the cache on ready(), newest-first ordering preserved", async () => {
    // Simulate a prior run: two traces + an index already persisted.
    const seed = {
      "panoptic:index": [
        { id: "old", addedAt: 0 },
        { id: "new", addedAt: 1 },
      ],
      "panoptic:trace:old": trace({ traceId: "old", startedAt: "2026-06-18T09:00:00.000Z" }),
      "panoptic:trace:new": trace({ traceId: "new", startedAt: "2026-06-18T11:00:00.000Z" }),
    };
    const driver = mockDriver(seed);
    const store = createCacheTraceStore(driver as never);

    // Empty until hydrated.
    expect(store.size).toBe(0);

    await store.ready();

    expect(store.size).toBe(2);
    expect(store.get("old")?.traceId).toBe("old");
    expect(store.get("new")?.traceId).toBe("new");

    const ordered = store.query();
    expect(ordered[0]?.traceId).toBe("new");
    expect(ordered[1]?.traceId).toBe("old");
  });

  it("continues the insertion counter after hydration so new adds persist a coherent index", async () => {
    const seed = {
      "panoptic:index": [{ id: "old", addedAt: 5 }],
      "panoptic:trace:old": trace({ traceId: "old", startedAt: "2026-06-18T09:00:00.000Z" }),
    };
    const driver = mockDriver(seed);
    const store = createCacheTraceStore(driver as never);

    await store.ready();
    store.add(trace({ traceId: "fresh", startedAt: "2026-06-18T12:00:00.000Z" }));
    await flush();

    const index = driver.storage.get("panoptic:index") as Array<{ id: string; addedAt: number }>;
    expect(index.map((entry) => entry.id)).toEqual(["old", "fresh"]);
    // Fresh entry must sort after the hydrated one.
    const fresh = index.find((entry) => entry.id === "fresh");
    const old = index.find((entry) => entry.id === "old");
    expect(fresh!.addedAt).toBeGreaterThan(old!.addedAt);
  });

  it("treats a missing index as an empty store on ready()", async () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);

    await store.ready();

    expect(store.size).toBe(0);
    expect(store.query()).toHaveLength(0);
  });

  it("evicts the oldest trace from both mirror and cache when capacity is exceeded", async () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never, { capacity: 2 });

    store.add(trace({ traceId: "t1" }));
    store.add(trace({ traceId: "t2" }));
    store.add(trace({ traceId: "t3" }));
    await flush();

    expect(store.size).toBe(2);
    expect(store.get("t1")).toBeUndefined();
    expect(driver.storage.has("panoptic:trace:t1")).toBe(false);
    expect(store.get("t2")).toBeDefined();
    expect(store.get("t3")).toBeDefined();
  });

  it("clears the mirror and purges persisted traces + index", async () => {
    const driver = mockDriver();
    const store = createCacheTraceStore(driver as never);
    store.add(trace({ traceId: "a" }));
    store.add(trace({ traceId: "b" }));
    await flush();

    store.clear();
    await flush();

    expect(store.size).toBe(0);
    expect(store.query()).toHaveLength(0);
    expect(driver.storage.has("panoptic:trace:a")).toBe(false);
    expect(driver.storage.has("panoptic:trace:b")).toBe(false);
    expect(driver.storage.has("panoptic:index")).toBe(false);
  });

  it("routes a swallowed cache write failure to onError without throwing into add()", async () => {
    const driver = mockDriver();
    driver.set.mockRejectedValue(new Error("cache down"));
    const onError = vi.fn();
    const store = createCacheTraceStore(driver as never, { onError });

    // add() must never throw even though the write-through fails.
    expect(() => store.add(trace({ traceId: "t1" }))).not.toThrow();
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    // Mirror still reflects the write — runtime reads are unaffected.
    expect(store.get("t1")?.traceId).toBe("t1");
  });

  it("routes a hydration failure to onError and leaves the mirror empty", async () => {
    const driver = mockDriver();
    driver.get.mockRejectedValue(new Error("cache down"));
    const onError = vi.fn();
    const store = createCacheTraceStore(driver as never, { onError });

    await store.ready();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });
});
