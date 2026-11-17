import type { DevtoolsExplainResult } from "../contracts";
import type { DevtoolsStoredSample } from "../store/types";
import type {
  DevtoolsCollector,
  DevtoolsDisposer,
  DevtoolsQuery,
  DevtoolsRequest,
} from "../../types";
import type {
  DevtoolsCaptureDeps,
  DevtoolsErrorGroups,
  DevtoolsProductionCapture,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRouteStatsStore,
} from "./types";

export type * from "./types";

/** The production capture of this process. Owner: WP-4. */
export function createProductionCapture(_deps: DevtoolsCaptureDeps): DevtoolsProductionCapture {
  throw new Error("not implemented");
}

/** Bounded per-shape query statistics. Owner: WP-4. */
export function createQueryStats(_limits: {
  maxShapes: number;
  instance: string;
}): DevtoolsQueryStats {
  throw new Error("not implemented");
}

/** Bounded per-route statistics. Owner: WP-4. */
export function createRouteStats(_limits: {
  maxRoutes: number;
  instance: string;
}): DevtoolsRouteStatsStore {
  throw new Error("not implemented");
}

/** Bounded error groups. Owner: WP-4. */
export function createErrorGroups(_limits: { maxGroups: number }): DevtoolsErrorGroups {
  throw new Error("not implemented");
}

/** Bounded recent logs (200 entries). Owner: WP-4. */
export function createRecentLogs(_limits: { maxEntries: number }): DevtoolsRecentLogs {
  throw new Error("not implemented");
}

/**
 * Turns a sampled request into a stored sample with every value removed: SQL
 * replaced by its shape, no bindings, no Mongo pipeline, no log context, no
 * phase attributes, cache operations reduced to counts.
 *
 * Owner: WP-4.
 */
export function toStoredSample(
  _request: DevtoolsRequest,
  _instance: string,
  _droppedQueries: number,
): DevtoolsStoredSample {
  throw new Error("not implemented");
}

/**
 * Development: feeds the statistics from the development collector's settled
 * requests (every request, no sampling), so the Queries, Routes and Errors
 * tabs work in `warlock dev` too.
 *
 * Owner: WP-4.
 */
export function attachDevelopmentStats(
  _collector: DevtoolsCollector,
  _parts: {
    queries: DevtoolsQueryStats;
    routes: DevtoolsRouteStatsStore;
    errors: DevtoolsErrorGroups;
    logs: DevtoolsRecentLogs;
    nPlusOneThreshold: number;
  },
): DevtoolsDisposer {
  throw new Error("not implemented");
}

/**
 * EXPLAIN by shape id from the examples `queries` kept, used by the production
 * capture and by development (`POST /api/queries/:shapeId/explain`). Plain
 * `EXPLAIN (FORMAT JSON)` / MongoDB `queryPlanner` unless `executing`; never
 * an executing plan for anything but a PostgreSQL `SELECT`/`WITH` or a
 * MongoDB `find`/`aggregate`/`count`. `run` executes the statement on the
 * query's own connection (injected for specs; default: cascade's
 * `dataSourceRegistry`).
 *
 * Owner: WP-4.
 */
export function createShapeExplainer(_input: {
  queries: DevtoolsQueryStats;
  executing: boolean;
  instance: string;
  run?: (
    query: DevtoolsQuery,
    statement: { type: "sql"; sql: string } | { type: "mongo"; command: Record<string, unknown> },
  ) => Promise<unknown>;
}): (shapeId: string) => Promise<DevtoolsExplainResult> {
  throw new Error("not implemented");
}
