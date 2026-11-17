import { describe, expect, it } from "vitest";
import {
  createLocalReporter,
  type DevtoolsHealthHistory,
  type DevtoolsResourceMonitor,
} from "../../../src/production/insights";
import { health, instance, point, route, shape, snapshot } from "./helpers";

function parts(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, number> = {};
  const note = (name: string, limit: number) => {
    calls[name] = limit;
  };
  const resources: DevtoolsResourceMonitor = {
    start() {},
    stop() {},
    sample: () => point(1),
    snapshot: () => snapshot(1),
    history: () => [point(0), point(1)],
  };
  const healthHistory: DevtoolsHealthHistory = {
    start() {},
    stop() {},
    check: async () => health,
    report: () => health,
  };

  return {
    calls,
    parts: {
      instance: instance("a"),
      resources,
      health: healthHistory,
      jobs: async () => ({ available: { scheduler: true, queue: false }, schedules: [], queues: [] }),
      queries: {
        record() {},
        recordNPlusOne() {},
        rememberExample() {},
        example: () => undefined,
        snapshot: (limit: number) => (note("queries", limit), [shape("q", [5])]),
        evicted: () => 4,
        clear() {},
      },
      routes: {
        record() {},
        snapshot: (limit: number) => (note("routes", limit), [route("GET /", [5])]),
        evicted: () => 2,
        clear() {},
      },
      errors: { record() {}, snapshot: (limit: number) => (note("errors", limit), []), evicted: () => 1, clear() {} },
      logs: { record() {}, snapshot: (limit: number) => (note("logs", limit), []), clear() {} },
      counters: null,
      now: () => 9000,
      ...overrides,
    },
  };
}

describe("createLocalReporter", () => {
  it("assembles the report with the contract limits", async () => {
    const { parts: p, calls } = parts();
    const report = await createLocalReporter(p as never).snapshot();

    expect(calls).toEqual({ queries: 200, routes: 200, errors: 50, logs: 50 });
    expect(report.at).toBe(9000);
    expect(report.instance.seenAt).toBe(9000);
    expect(report.resources.history).toHaveLength(2);
    expect(report.queries).toHaveLength(1);
    expect(report.jobs.available.scheduler).toBe(true);
  });

  it("uses zero counters at sample rate 1 without a capture", async () => {
    const report = await createLocalReporter(parts().parts as never).snapshot();

    expect(report.capture).toMatchObject({
      sampleRate: 1,
      requests: 0,
      evictedShapes: 4,
      evictedRoutes: 2,
      evictedErrors: 1,
    });
  });

  it("uses the capture counters in production", async () => {
    const counters = () => ({ sampleRate: 0.2, requests: 5, sampled: 1, keptUnsampled: 0, stored: 1, droppedStored: 0, evictedShapes: 0, evictedRoutes: 0, evictedErrors: 0, droppedQueries: 0 });
    const report = await createLocalReporter(parts({ counters }).parts as never).snapshot();

    expect(report.capture.sampleRate).toBe(0.2);
    expect(report.capture.requests).toBe(5);
  });

  it("still reports when the jobs reader fails", async () => {
    const jobs = async () => {
      throw new Error("x");
    };
    const report = await createLocalReporter(parts({ jobs }).parts as never).snapshot();

    expect(report.jobs.available).toEqual({ scheduler: false, queue: false });
  });
});
