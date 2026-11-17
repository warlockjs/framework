import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResourceMonitor } from "../../../src/production/insights";

type GcFn = (kind: "minor" | "major" | "incremental" | "weakcb", durationMs: number) => void;

function setup(historySize = 3) {
  let now = 1000;
  let cpu = { user: 0, system: 0 };
  let elu = { idle: 0, active: 0 };
  let gc: GcFn = () => {};
  const stopGc = vi.fn();
  const delay = {
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
    percentile: (p: number) => (p === 50 ? 2e6 : 9e6),
    max: 12e6,
  };

  const monitor = createResourceMonitor({
    intervalMs: 5000,
    historySize,
    sources: {
      now: () => now,
      memoryUsage: () => ({ rss: 10, heapUsed: 5, heapTotal: 8, external: 1 }),
      cpuUsage: () => cpu,
      heapLimit: () => 999,
      uptime: () => 42,
      eventLoopDelay: () => delay,
      eventLoopUtilization: () => elu,
      observeGc: (onGc) => {
        gc = onGc;

        return stopGc;
      },
    },
  });

  return {
    monitor,
    delay,
    stopGc,
    advance(ms: number, cpuMicros: number, active: number, idle: number) {
      now += ms;
      cpu = { user: cpu.user + cpuMicros, system: cpu.system };
      elu = { idle: elu.idle + idle, active: elu.active + active };
    },
    gc: (kind: Parameters<GcFn>[0], ms: number) => gc(kind, ms),
  };
}

describe("createResourceMonitor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes CPU percent, loop delay and utilization from deltas", () => {
    const { monitor, advance } = setup();

    advance(1000, 500_000, 30, 70);
    const point = monitor.sample();

    expect(point.cpuPercent).toBeCloseTo(50);
    expect(point.eventLoopUtilization).toBeCloseTo(0.3);
    expect(point.eventLoopDelayP50Ms).toBe(2);
    expect(point.eventLoopDelayP99Ms).toBe(9);
    expect(point.eventLoopDelayMaxMs).toBe(12);
    expect(point.rssBytes).toBe(10);
  });

  it("keeps at most historySize points, oldest first", () => {
    const { monitor, advance } = setup(3);

    for (let i = 0; i < 5; i++) {
      advance(1000, 0, 0, 1);
      monitor.sample();
    }

    const history = monitor.history();

    expect(history).toHaveLength(3);
    expect(history[0]!.at).toBeLessThan(history[2]!.at);
  });

  it("counts garbage collections per point and in total", () => {
    const { monitor, advance, gc } = setup();

    monitor.start();
    gc("minor", 2);
    gc("major", 10);
    advance(5000, 0, 0, 1);
    const first = monitor.sample();

    gc("minor", 1);
    advance(5000, 0, 0, 1);
    const second = monitor.sample();
    const snapshot = monitor.snapshot();

    expect(first.gcCount).toBe(2);
    expect(first.gcPauseMs).toBe(12);
    expect(second.gcCount).toBe(1);
    expect(snapshot.gcByKind.minor).toEqual({ count: 2, pauseMs: 3 });
    expect(snapshot.gcByKind.major).toEqual({ count: 1, pauseMs: 10 });
    expect(snapshot.heapLimitBytes).toBe(999);
    expect(snapshot.uptimeSeconds).toBe(42);
    monitor.stop();
  });

  it("samples on its timer once started, and stops cleanly", () => {
    const { monitor, advance, delay, stopGc } = setup();

    monitor.start();
    expect(delay.enable).toHaveBeenCalled();
    advance(5000, 0, 0, 1);
    vi.advanceTimersByTime(5000);
    expect(monitor.history()).toHaveLength(1);

    monitor.stop();
    vi.advanceTimersByTime(20_000);
    expect(monitor.history()).toHaveLength(1);
    expect(stopGc).toHaveBeenCalled();
    expect(delay.disable).toHaveBeenCalled();
  });

  it("takes a reading for the snapshot when there is no history", () => {
    const { monitor } = setup();

    expect(monitor.snapshot().rssBytes).toBe(10);
    expect(monitor.history()).toHaveLength(1);
  });

  it("works with the real process sources", () => {
    const monitor = createResourceMonitor();
    const point = monitor.sample();

    expect(point.rssBytes).toBeGreaterThan(0);
    expect(monitor.snapshot().heapLimitBytes).toBeGreaterThan(0);
  });
});
