import type { DevtoolsHealthStatusReader } from "./readiness";
import type { DevtoolsInstanceInfo, DevtoolsInstanceReport } from "../contracts";
import type {
  DevtoolsErrorGroups,
  DevtoolsProductionCapture,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRouteStatsStore,
} from "../capture/types";
import type { ResolvedDevtoolsProductionOptions } from "../options";
import type { DevtoolsStore } from "../store/types";
import type {
  DevtoolsHealthHistory,
  DevtoolsInsights,
  DevtoolsJobsReader,
  DevtoolsLocalReporter,
  DevtoolsReportWriter,
  DevtoolsResourceMonitor,
} from "./types";

export type * from "./types";
export type { DevtoolsHealthStatusReader } from "./readiness";

/** This process's identity (host, pid, pm2/cluster worker, start time). Owner: WP-5. */
export function createInstanceInfo(_now?: number): DevtoolsInstanceInfo {
  throw new Error("not implemented");
}

/** Resource sampling every `intervalMs` (default 5000), `historySize` points (default 120). Owner: WP-5. */
export function createResourceMonitor(
  _options: { intervalMs?: number; historySize?: number } = {},
): DevtoolsResourceMonitor {
  throw new Error("not implemented");
}

/** Readiness checks every `intervalMs` (default 30000), 60 history entries. Owner: WP-5. */
export function createHealthHistory(
  _options: { intervalMs?: number; size?: number; readiness?: DevtoolsHealthStatusReader } = {},
): DevtoolsHealthHistory {
  throw new Error("not implemented");
}

/** Reads the scheduler's jobs and the queue's counts when those packages are installed. Owner: WP-5. */
export function createJobsReader(): DevtoolsJobsReader {
  throw new Error("not implemented");
}

/** This process's report from its parts (production: from the capture; development: from the dev stats). Owner: WP-5. */
export function createLocalReporter(_parts: {
  instance: DevtoolsInstanceInfo;
  resources: DevtoolsResourceMonitor;
  health: DevtoolsHealthHistory;
  jobs: DevtoolsJobsReader;
  queries: DevtoolsQueryStats;
  routes: DevtoolsRouteStatsStore;
  errors: DevtoolsErrorGroups;
  logs: DevtoolsRecentLogs;
  counters: DevtoolsProductionCapture["counters"] | null;
}): DevtoolsLocalReporter {
  throw new Error("not implemented");
}

/**
 * Writes the report every `production.reportIntervalMs`, and every 10
 * minutes prunes: reports unseen for 5 minutes, samples older than
 * `requestRetentionHours`, expired sessions and invites, audit entries older
 * than `auditRetentionDays`. Timers are `unref`ed; a failed write is logged
 * once per minute, never thrown.
 *
 * Owner: WP-5.
 */
export function startReportWriter(_input: {
  reporter: DevtoolsLocalReporter;
  store: DevtoolsStore;
  production: ResolvedDevtoolsProductionOptions;
  warn?: (message: string) => void;
}): DevtoolsReportWriter {
  throw new Error("not implemented");
}

/** Development insights: this process only. Owner: WP-5. */
export function createLocalInsights(_reporter: DevtoolsLocalReporter): DevtoolsInsights {
  throw new Error("not implemented");
}

/** Production insights: merged instance reports from the store plus this process live. Owner: WP-5. */
export function createSharedInsights(_input: {
  store: DevtoolsStore;
  reporter: DevtoolsLocalReporter;
  sampleRate: number;
}): DevtoolsInsights {
  throw new Error("not implemented");
}

/** Trims a report's lists from the end until its JSON is at most `maxBytes` (default 256 KB). Owner: WP-5. */
export function capReportSize(
  _report: DevtoolsInstanceReport,
  _maxBytes = 262_144,
): DevtoolsInstanceReport {
  throw new Error("not implemented");
}
