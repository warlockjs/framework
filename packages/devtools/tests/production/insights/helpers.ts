import type {
  DevtoolsErrorGroup,
  DevtoolsHealthReport,
  DevtoolsInstanceInfo,
  DevtoolsInstanceReport,
  DevtoolsJobsReport,
  DevtoolsQueryShapeStats,
  DevtoolsReportLogEntry,
  DevtoolsResourcePoint,
  DevtoolsResourceSnapshot,
  DevtoolsRouteStats,
} from "../../../src/production/contracts";
import { createHistogram, recordDuration } from "../../../src/production/stats";
import type { DevtoolsLocalReporter } from "../../../src/production/insights/types";

export function instance(
  id: string,
  overrides: Partial<DevtoolsInstanceInfo> = {},
): DevtoolsInstanceInfo {
  return {
    id,
    label: `host pid ${id}`,
    host: "host",
    pid: 1,
    worker: null,
    startedAt: 1000,
    seenAt: 1000,
    nodeVersion: "v22.0.0",
    ...overrides,
  };
}

export function point(at: number): DevtoolsResourcePoint {
  return {
    at,
    rssBytes: 100,
    heapUsedBytes: 50,
    heapTotalBytes: 80,
    externalBytes: 5,
    cpuPercent: 1,
    eventLoopDelayP50Ms: 1,
    eventLoopDelayP99Ms: 2,
    eventLoopDelayMaxMs: 3,
    eventLoopUtilization: 0.1,
    gcCount: 0,
    gcPauseMs: 0,
  };
}

export function snapshot(at: number): DevtoolsResourceSnapshot {
  return {
    ...point(at),
    heapLimitBytes: 1000,
    uptimeSeconds: 10,
    gcByKind: {
      minor: { count: 0, pauseMs: 0 },
      major: { count: 0, pauseMs: 0 },
      incremental: { count: 0, pauseMs: 0 },
      weakcb: { count: 0, pauseMs: 0 },
    },
  };
}

export function histogramOf(...durations: number[]) {
  const histogram = createHistogram();

  for (const duration of durations) recordDuration(histogram, duration);

  return histogram;
}

export function shape(
  id: string,
  durations: number[],
  overrides: Partial<DevtoolsQueryShapeStats> = {},
): DevtoolsQueryShapeStats {
  return {
    id,
    shape: `select ${id}`,
    driver: "postgres",
    connection: "main",
    count: durations.length,
    errors: 0,
    histogram: histogramOf(...durations),
    nPlusOne: { requests: 0, maxPerRequest: 0 },
    slowest: null,
    firstSeen: 1,
    lastSeen: 2,
    explainable: true,
    ...overrides,
  };
}

export function route(key: string, durations: number[], errors = 0): DevtoolsRouteStats {
  const [method = "GET", path = "/"] = key.split(" ");

  return {
    key,
    method,
    route: path,
    count: durations.length,
    errors,
    histogram: histogramOf(...durations),
    phases: [],
    slowest: null,
  };
}

export function errorGroup(id: string, lastSeen: number, count = 1): DevtoolsErrorGroup {
  return {
    id,
    message: `boom ${id}`,
    name: "Error",
    source: "request",
    route: "/x",
    status: 500,
    count,
    firstSeen: 1,
    lastSeen,
    lastRequestId: null,
    stack: null,
  };
}

export function logEntry(
  at: number,
  level: DevtoolsReportLogEntry["level"] = "warn",
  module = "http",
): DevtoolsReportLogEntry {
  return { level, module, action: "act", message: `m${at}`, at, requestId: null };
}

export const health: DevtoolsHealthReport = {
  status: "ok",
  checkedAt: 1,
  checks: { db: true },
  history: [],
};
export const jobs: DevtoolsJobsReport = {
  available: { scheduler: false, queue: false },
  schedules: [],
  queues: [],
};

export function report(
  id: string,
  at: number,
  parts: Partial<DevtoolsInstanceReport> = {},
): DevtoolsInstanceReport {
  return {
    instance: instance(id, { seenAt: at }),
    at,
    resources: { snapshot: snapshot(at), history: [point(at - 5000), point(at)] },
    queries: [],
    routes: [],
    errors: [],
    logs: [],
    health,
    jobs,
    capture: {
      sampleRate: 0.1,
      requests: 10,
      sampled: 1,
      keptUnsampled: 0,
      stored: 0,
      droppedStored: 0,
      evictedShapes: 1,
      evictedRoutes: 0,
      evictedErrors: 0,
      droppedQueries: 0,
    },
    ...parts,
  };
}

/** A reporter that returns `make()` each time. */
export function fakeReporter(
  id: string,
  make: () => DevtoolsInstanceReport,
): DevtoolsLocalReporter {
  return { instance: instance(id), snapshot: async () => make() };
}
