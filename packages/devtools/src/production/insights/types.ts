import type {
  DevtoolsErrorsView,
  DevtoolsHealthReport,
  DevtoolsHealthView,
  DevtoolsInstanceInfo,
  DevtoolsInstanceReport,
  DevtoolsInstancesView,
  DevtoolsJobsReport,
  DevtoolsJobsView,
  DevtoolsLogsView,
  DevtoolsQueryStatsView,
  DevtoolsResourcePoint,
  DevtoolsResourceSnapshot,
  DevtoolsResourcesView,
  DevtoolsRouteStatsView,
} from "../contracts";

/** Samples RSS, heap, CPU, event-loop delay and utilization, and GC of this process. */
export interface DevtoolsResourceMonitor {
  start(): void;
  stop(): void;
  /** Takes a reading now (also used by `start`'s timer). */
  sample(): DevtoolsResourcePoint;
  snapshot(): DevtoolsResourceSnapshot;
  /** Oldest first, at most `historySize` points. */
  history(): DevtoolsResourcePoint[];
}

/** Runs core's readiness checks on an interval and keeps a short history. */
export interface DevtoolsHealthHistory {
  start(): void;
  stop(): void;
  /** Runs the checks now. */
  check(): Promise<DevtoolsHealthReport>;
  report(): DevtoolsHealthReport;
}

/** Builds this process's report from its parts. */
export interface DevtoolsLocalReporter {
  readonly instance: DevtoolsInstanceInfo;
  snapshot(): Promise<DevtoolsInstanceReport>;
}

/** The `instance` query parameter: one instance id, or every instance. */
export type DevtoolsInstanceSelector = string | "all";

/** Query of the list views. */
export type DevtoolsInsightQuery = {
  instance: DevtoolsInstanceSelector;
  sort?: string;
  /** 1–500. */
  limit?: number;
  level?: string;
  module?: string;
};

/**
 * What the Resources, Queries, Routes, Health, Errors, Logs and Jobs tabs
 * read. Development: this process only. Production: the reports every
 * instance wrote to the database (fresh in the last 60 s; instances list:
 * last 5 min), with the answering instance's own report taken live.
 */
export interface DevtoolsInsights {
  instances(): Promise<DevtoolsInstancesView>;
  resources(query: DevtoolsInsightQuery): Promise<DevtoolsResourcesView>;
  queryStats(query: DevtoolsInsightQuery): Promise<DevtoolsQueryStatsView>;
  routeStats(query: DevtoolsInsightQuery): Promise<DevtoolsRouteStatsView>;
  health(query: DevtoolsInsightQuery): Promise<DevtoolsHealthView>;
  errors(query: DevtoolsInsightQuery): Promise<DevtoolsErrorsView>;
  logs(query: DevtoolsInsightQuery): Promise<DevtoolsLogsView>;
  jobs(query: DevtoolsInsightQuery): Promise<DevtoolsJobsView>;
}

/** Timers that write this process's report and prune old rows. */
export interface DevtoolsReportWriter {
  /** Writes one report now. */
  writeNow(): Promise<void>;
  stop(): Promise<void>;
}

/** The jobs report reader (scheduler and queue are optional packages). */
export type DevtoolsJobsReader = () => Promise<DevtoolsJobsReport>;
