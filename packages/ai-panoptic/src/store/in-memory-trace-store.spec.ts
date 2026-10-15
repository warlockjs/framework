import type { ReportStatus, Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { Trace } from "../contracts/trace.type";
import { createInMemoryTraceStore } from "./in-memory-trace-store";

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

describe("createInMemoryTraceStore", () => {
  it("ingests and retrieves a trace by id", () => {
    const store = createInMemoryTraceStore();

    store.add(trace({ traceId: "t1" }));

    expect(store.size).toBe(1);
    expect(store.get("t1")?.traceId).toBe("t1");
    expect(store.get("missing")).toBeUndefined();
  });

  it("overwrites a trace re-collected under the same id", () => {
    const store = createInMemoryTraceStore();

    store.add(trace({ traceId: "t1", status: "completed" }));
    store.add(trace({ traceId: "t1", status: "failed" }));

    expect(store.size).toBe(1);
    expect(store.get("t1")?.root.status).toBe("failed");
  });

  it("doubles as an exporter via export()", () => {
    const store = createInMemoryTraceStore();

    store.export(trace({ traceId: "t1" }));

    expect(store.name).toBe("in-memory-trace-store");
    expect(store.get("t1")).toBeDefined();
  });

  it("queries by session and returns newest-started first", () => {
    const store = createInMemoryTraceStore();
    store.add(trace({ traceId: "old", sessionId: "s1", startedAt: "2026-06-18T09:00:00.000Z" }));
    store.add(trace({ traceId: "new", sessionId: "s1", startedAt: "2026-06-18T11:00:00.000Z" }));
    store.add(trace({ traceId: "other", sessionId: "s2", startedAt: "2026-06-18T10:00:00.000Z" }));

    const result = store.query({ sessionId: "s1" });

    expect(result).toHaveLength(2);
    expect(result[0]?.traceId).toBe("new");
    expect(result[1]?.traceId).toBe("old");
  });

  it("returns all traces for an empty query", () => {
    const store = createInMemoryTraceStore();
    store.add(trace({ traceId: "a" }));
    store.add(trace({ traceId: "b" }));

    expect(store.query()).toHaveLength(2);
  });

  it("aggregates usage, cost, status counts, and duration over a slice", () => {
    const store = createInMemoryTraceStore();
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

  it("returns zeroed aggregate with undefined cost when nothing matches", () => {
    const store = createInMemoryTraceStore();
    store.add(trace({ traceId: "a", sessionId: "s1" }));

    const stats = store.aggregate({ sessionId: "no-match" });

    expect(stats.traces).toBe(0);
    expect(stats.usage).toEqual({ input: 0, output: 0, total: 0 });
    expect(stats.cost).toBeUndefined();
    expect(stats.totalDuration).toBe(0);
  });

  it("evicts the oldest trace when capacity is exceeded", () => {
    const store = createInMemoryTraceStore({ capacity: 2 });

    store.add(trace({ traceId: "t1" }));
    store.add(trace({ traceId: "t2" }));
    store.add(trace({ traceId: "t3" }));

    expect(store.size).toBe(2);
    expect(store.get("t1")).toBeUndefined();
    expect(store.get("t2")).toBeDefined();
    expect(store.get("t3")).toBeDefined();
  });

  it("refreshes insertion position on overwrite so eviction stays honest", () => {
    const store = createInMemoryTraceStore({ capacity: 2 });

    store.add(trace({ traceId: "t1" }));
    store.add(trace({ traceId: "t2" }));
    store.add(trace({ traceId: "t1" })); // refresh t1 -> now t2 is oldest
    store.add(trace({ traceId: "t3" }));

    expect(store.get("t2")).toBeUndefined();
    expect(store.get("t1")).toBeDefined();
    expect(store.get("t3")).toBeDefined();
  });

  it("clears every stored trace", () => {
    const store = createInMemoryTraceStore();
    store.add(trace({ traceId: "a" }));
    store.add(trace({ traceId: "b" }));

    store.clear();

    expect(store.size).toBe(0);
    expect(store.query()).toHaveLength(0);
  });
});
