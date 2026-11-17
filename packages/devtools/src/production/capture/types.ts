import type {
  DevtoolsCaptureCounters,
  DevtoolsErrorGroup,
  DevtoolsExplainResult,
  DevtoolsInstanceInfo,
  DevtoolsQueryShapeStats,
  DevtoolsReportLogEntry,
  DevtoolsRouteStats,
  DevtoolsSampleDetail,
  DevtoolsSampleSummary,
} from "../contracts";
import type { ResolvedDevtoolsProductionOptions } from "../options";
import type { DevtoolsSampleFilter, DevtoolsStore, DevtoolsStoredSample } from "../store/types";
import type {
  DevtoolsCollector,
  DevtoolsDisposer,
  DevtoolsQuery,
  DevtoolsRequest,
  ResolvedDevtoolsOptions,
} from "../../types";

/** One settled query, as the statistics need it (no values). */
export type DevtoolsQueryObservation = {
  shape: string;
  driver: "postgres" | "mongodb";
  connection: string;
  durationMs: number;
  failed: boolean;
  at: number;
  route: string | null;
  requestId: string | null;
};

/**
 * Per-shape query statistics of this process, bounded to `maxShapes`
 * (least recently seen evicted).
 */
export interface DevtoolsQueryStats {
  record(query: DevtoolsQueryObservation): void;
  /** One sampled request ran `shape` `count` times, at or above the N+1 threshold. */
  recordNPlusOne(shape: string, count: number): void;
  /**
   * Keeps the slowest example of a shape WITH its SQL/command and bindings,
   * in memory only, for EXPLAIN. Never serialized, never sent to a browser.
   */
  rememberExample(query: DevtoolsQuery): void;
  /** The kept example for a shape id, or `undefined` when this process has none. */
  example(shapeId: string): DevtoolsQuery | undefined;
  /** At most `limit` shapes, highest total time first. */
  snapshot(limit: number): DevtoolsQueryShapeStats[];
  evicted(): number;
  clear(): void;
}

/** One settled request, as the route statistics need it. */
export type DevtoolsRequestObservation = {
  method: string;
  route: string;
  status: number | null;
  failed: boolean;
  durationMs: number;
  at: number;
  requestId: string | null;
  phases: readonly { name: string; durationMs: number }[];
};

/** Per-route statistics of this process, bounded to `maxRoutes`. */
export interface DevtoolsRouteStatsStore {
  record(request: DevtoolsRequestObservation): void;
  snapshot(limit: number): DevtoolsRouteStats[];
  evicted(): number;
  clear(): void;
}

/** Errors grouped by fingerprint, bounded to `maxErrorGroups`. */
export interface DevtoolsErrorGroups {
  record(input: {
    source: "request" | "log";
    message: string;
    name: string | null;
    stack: string | null;
    route: string | null;
    status: number | null;
    requestId: string | null;
    at: number;
  }): void;
  snapshot(limit: number): DevtoolsErrorGroup[];
  evicted(): number;
  clear(): void;
}

/** Recent warn/error log entries (no context), bounded. */
export interface DevtoolsRecentLogs {
  record(entry: DevtoolsReportLogEntry): void;
  /** Newest first. */
  snapshot(limit: number, filter?: { level?: string; module?: string }): DevtoolsReportLogEntry[];
  clear(): void;
}

/** Where request rows and details come from: memory + request log (development) or stored samples (production). */
export interface DevtoolsRequestSource {
  list(filter: DevtoolsSampleFilter): Promise<DevtoolsSampleSummary[]>;
  /** The stored detail, or `null` (the route then tries the persisted request log). */
  get(id: string): Promise<DevtoolsSampleDetail | DevtoolsSampleSummary | null>;
  /** Clears what this source can clear; returns how many entries went. */
  clear(): Promise<number>;
}

/** What EXPLAIN executes: a SQL statement or a MongoDB command, on the query's own connection. */
export type DevtoolsExplainStatement =
  | { type: "sql"; sql: string }
  | { type: "mongo"; command: Record<string, unknown> };

/** Executes an EXPLAIN statement and returns the database's answer. */
export type DevtoolsExplainRunner = (
  query: DevtoolsQuery,
  statement: DevtoolsExplainStatement,
) => Promise<unknown>;

/** What `createProductionCapture` needs. */
export type DevtoolsCaptureDeps = {
  options: ResolvedDevtoolsOptions;
  production: ResolvedDevtoolsProductionOptions;
  instance: DevtoolsInstanceInfo;
  /** Where samples are written; `null` keeps them in memory only. */
  store: DevtoolsStore | null;
  /** Requests to the dashboard path are never captured. */
  isDashboardPath(path: string): boolean;
  random?: () => number;
  now?: () => number;
  warn?: (message: string) => void;
  /** Runs an EXPLAIN statement; defaults to cascade's data source registry (injected for specs). */
  run?: DevtoolsExplainRunner;
};

/**
 * The production capture of one process: sampling, the bounded in-memory
 * ring of sampled requests (the live view), statistics, error groups, recent
 * logs, the sample writer and EXPLAIN.
 *
 * Unsampled requests cost one random draw at start and one comparison at
 * end; they add nothing to the statistics.
 */
export interface DevtoolsProductionCapture {
  /** The ring of sampled requests (`maxRequests`), feeding the live stream. */
  readonly collector: DevtoolsCollector;
  readonly queries: DevtoolsQueryStats;
  readonly routes: DevtoolsRouteStatsStore;
  readonly errors: DevtoolsErrorGroups;
  readonly logs: DevtoolsRecentLogs;
  /** Rows and details for the Requests tab (stored samples, then this process's memory). */
  readonly requests: DevtoolsRequestSource;
  counters(): DevtoolsCaptureCounters;
  /** Registers the tracing, query and log hooks (sampled). */
  attach(): Promise<DevtoolsDisposer>;
  /**
   * EXPLAIN for a shape id, from this process's kept example. Throws
   * `DevtoolsApiError` `explain.elsewhere` (no example here),
   * `explain.unsupported` or `explain.failed`. Plain EXPLAIN / `queryPlanner`
   * unless `production.explain.executing`.
   */
  explain(shapeId: string): Promise<DevtoolsExplainResult>;
  /** Writes pending samples now (shutdown, specs). */
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

/** Strips every value from a sampled request (see ARCHITECTURE "Redaction"). */
export type DevtoolsSampleRedactor = (
  request: DevtoolsRequest,
  instance: string,
  droppedQueries: number,
) => DevtoolsStoredSample;
