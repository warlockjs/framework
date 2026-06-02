import { describe, expect, it, vi } from "vitest";
import type { BenchmarkChannel, BenchmarkErrorResult } from "../../../src/benchmark";
import { BenchmarkProfiler, BenchmarkSnapshots, ConsoleChannel } from "../../../src/benchmark";
import type { BenchmarkSuccessResult } from "../../../src/benchmark/types";

const createSuccess = (
  name: string,
  latency: number,
  value: unknown = null,
): BenchmarkSuccessResult<unknown> => ({
  name,
  success: true,
  latency,
  value,
  state: "good",
  startedAt: new Date(),
  endedAt: new Date(),
});

const createError = (name: string, latency: number): BenchmarkErrorResult => ({
  name,
  success: false,
  error: new Error("Test"),
  latency,
  state: "poor",
  startedAt: new Date(),
  endedAt: new Date(),
});

describe("BenchmarkProfiler", () => {
  it("record() pushes latency and stats returns data", () => {
    const profiler = new BenchmarkProfiler();
    profiler.record(createSuccess("test", 100));

    const stats = profiler.stats("test");
    expect(stats).toBeDefined();
    expect(stats?.count).toBe(1);
    expect(stats?.p50).toBe(100);
  });

  it("Ring buffer evicts oldest when full and sum is correct after eviction", () => {
    const profiler = new BenchmarkProfiler({ maxSamples: 3 });
    profiler.record(createSuccess("test", 10)); // evicted
    profiler.record(createSuccess("test", 20)); // in
    profiler.record(createSuccess("test", 30)); // in
    profiler.record(createSuccess("test", 40)); // in

    const stats = profiler.stats("test");
    expect(stats?.count).toBe(4); // unbounded
    expect(stats?.avg).toBe((20 + 30 + 40) / 3);
  });

  it("errors counter and rate", () => {
    const profiler = new BenchmarkProfiler();
    profiler.record(createSuccess("test", 10));
    profiler.record(createError("test", 20));
    profiler.record(createError("test", 30));
    profiler.record(createSuccess("test", 40));

    const stats = profiler.stats("test");
    expect(stats?.count).toBe(4);
    expect(stats?.errorRate).toBe(0.5);
  });

  it("p50 / p95 / p99 math", () => {
    const profiler = new BenchmarkProfiler();
    for (let i = 1; i <= 100; i++) {
      profiler.record(createSuccess("test", i));
    }
    const stats = profiler.stats("test");
    expect(stats?.p50).toBe(51);
    expect(stats?.p95).toBe(96);
    expect(stats?.p99).toBe(100);
  });

  it("reset(name) clears one", () => {
    const profiler = new BenchmarkProfiler();
    profiler.record(createSuccess("A", 10));
    profiler.record(createSuccess("B", 10));
    profiler.reset("A");

    expect(profiler.stats("A")).toBeUndefined();
    expect(profiler.stats("B")).toBeDefined();
  });

  it("reset() clears all", () => {
    const profiler = new BenchmarkProfiler();
    profiler.record(createSuccess("A", 10));
    profiler.record(createSuccess("B", 10));
    profiler.reset();

    expect(profiler.stats("A")).toBeUndefined();
    expect(profiler.stats("B")).toBeUndefined();
  });

  it("flush() calls all channels", async () => {
    const channel1: BenchmarkChannel = { onFlush: vi.fn() };
    const channel2: BenchmarkChannel = { onFlush: vi.fn() };
    const profiler = new BenchmarkProfiler({ channels: [channel1, channel2] });

    profiler.record(createSuccess("test", 10));
    await profiler.flush();

    expect(channel1.onFlush).toHaveBeenCalledTimes(1);
    expect(channel2.onFlush).toHaveBeenCalledTimes(1);
  });

  it("dispose() clears interval", () => {
    vi.useFakeTimers();
    const channel: BenchmarkChannel = { onFlush: vi.fn() };
    const profiler = new BenchmarkProfiler({ flushEvery: 1000, channels: [channel] });

    profiler.record(createSuccess("test", 10));
    vi.advanceTimersByTime(1100);
    expect(channel.onFlush).toHaveBeenCalled();

    profiler.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

describe("BenchmarkSnapshots", () => {
  it('capture:"error" checks', () => {
    const snapshots = new BenchmarkSnapshots({ capture: "error" });
    snapshots.record(createSuccess("test", 10));
    snapshots.record(createError("test", 10));

    const data = snapshots.getSnapshots("test");
    expect(data.length).toBe(1);
    expect(data[0].success).toBe(false);
  });

  it('capture:"value" checks', () => {
    const snapshots = new BenchmarkSnapshots({ capture: "value" });
    snapshots.record(createSuccess("test", 10));
    snapshots.record(createError("test", 10));

    const data = snapshots.getSnapshots("test");
    expect(data.length).toBe(1);
    expect(data[0].success).toBe(true);
  });

  it('capture:"all" checks', () => {
    const snapshots = new BenchmarkSnapshots({ capture: "all" });
    snapshots.record(createSuccess("test", 10));
    snapshots.record(createError("test", 10));

    const data = snapshots.getSnapshots("test");
    expect(data.length).toBe(2);
  });

  it("Ring buffer eviction", () => {
    const snapshots = new BenchmarkSnapshots({ maxSnapshots: 2, capture: "all" });
    snapshots.record(createSuccess("test", 1));
    snapshots.record(createSuccess("test", 2));
    snapshots.record(createSuccess("test", 3)); // evicts 1

    const data = snapshots.getSnapshots("test");
    expect(data.length).toBe(2);
    expect(data[0].latency).toBe(2);
    expect(data[1].latency).toBe(3);
  });

  it("allSnapshots and reset", () => {
    const snapshots = new BenchmarkSnapshots({ capture: "all" });
    snapshots.record(createSuccess("A", 1));
    snapshots.record(createSuccess("B", 1));

    const all = snapshots.allSnapshots();
    expect(Object.keys(all)).toEqual(["A", "B"]);

    snapshots.reset("A");
    expect(Object.keys(snapshots.allSnapshots())).toEqual(["B"]);

    snapshots.reset();
    expect(Object.keys(snapshots.allSnapshots())).toEqual([]);
  });
});

describe("ConsoleChannel", () => {
  it("prints correctly", () => {
    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    const channel = new ConsoleChannel();
    channel.onFlush({
      "test-op": {
        p50: 10,
        p90: 18,
        p95: 20,
        p99: 30,
        avg: 15,
        min: 5,
        max: 35,
        count: 100,
        errors: 10,
        errorRate: 0.1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
