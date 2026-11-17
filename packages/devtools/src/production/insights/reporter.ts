import type {
  DevtoolsCaptureCounters,
  DevtoolsInstanceInfo,
  DevtoolsInstanceReport,
  DevtoolsJobsReport,
} from "../contracts";
import type {
  DevtoolsErrorGroups,
  DevtoolsProductionCapture,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRouteStatsStore,
} from "../capture/types";
import type {
  DevtoolsHealthHistory,
  DevtoolsJobsReader,
  DevtoolsLocalReporter,
  DevtoolsResourceMonitor,
} from "./types";

const emptyJobs = (): DevtoolsJobsReport => ({
  available: { scheduler: false, queue: false },
  schedules: [],
  queues: [],
});

/** This process's report from its parts (production: from the capture; development: from the dev stats). */
export function createLocalReporter(parts: {
  instance: DevtoolsInstanceInfo;
  resources: DevtoolsResourceMonitor;
  health: DevtoolsHealthHistory;
  jobs: DevtoolsJobsReader;
  queries: DevtoolsQueryStats;
  routes: DevtoolsRouteStatsStore;
  errors: DevtoolsErrorGroups;
  logs: DevtoolsRecentLogs;
  counters: DevtoolsProductionCapture["counters"] | null;
  now?: () => number;
}): DevtoolsLocalReporter {
  const now = parts.now ?? Date.now;

  return {
    instance: parts.instance,

    async snapshot() {
      const at = now();
      let jobs: DevtoolsJobsReport;

      try {
        jobs = await parts.jobs();
      } catch {
        jobs = emptyJobs();
      }

      const capture: DevtoolsCaptureCounters = parts.counters
        ? parts.counters()
        : {
            sampleRate: 1,
            requests: 0,
            sampled: 0,
            keptUnsampled: 0,
            stored: 0,
            droppedStored: 0,
            evictedShapes: parts.queries.evicted(),
            evictedRoutes: parts.routes.evicted(),
            evictedErrors: parts.errors.evicted(),
            droppedQueries: 0,
          };

      const report: DevtoolsInstanceReport = {
        instance: { ...parts.instance, seenAt: at },
        at,
        resources: { snapshot: parts.resources.snapshot(), history: parts.resources.history() },
        queries: parts.queries.snapshot(200),
        routes: parts.routes.snapshot(200),
        errors: parts.errors.snapshot(50),
        logs: parts.logs.snapshot(50),
        health: parts.health.report(),
        jobs,
        capture,
      };

      return report;
    },
  };
}
