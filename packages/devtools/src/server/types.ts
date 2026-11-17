import type { RequestLogFilter, RequestLogRecord, RequestLogSummary } from "@warlock.js/core";
import type { DevtoolsRequestSource } from "../production/capture/types";
import type {
  DevtoolsExplainResult,
  DevtoolsInstanceInfo,
  DevtoolsMode,
} from "../production/contracts";
import type { DevtoolsInsights } from "../production/insights/types";
import type { DevtoolsAgentTraceSource } from "../sources/agent-trace-source";
import type { DevtoolsAiSource } from "../sources/ai-source";
import type { ProcessPanel } from "../process-panel";
import type {
  DevtoolsCollector,
  DevtoolsPanel,
  DevtoolsQuery,
  ResolvedDevtoolsOptions,
} from "../types";

/**
 * One row of the route map, matching what `warlock routes --json` reads from
 * core's router.
 */
export type DevtoolsRouteRow = {
  method: string;
  path: string;
  name?: string;
  middleware?: string[];
};

/**
 * The persistent request log (core's `http.logging.requests`), injected so
 * devtools never imports core at load. Reads the JSON-lines files, so
 * requests survive restarts.
 */
export type DevtoolsRequestLogSource = {
  list(filter: RequestLogFilter): Promise<RequestLogSummary[]>;
  get(id: string): Promise<RequestLogRecord | undefined>;
  /** The request as a `curl` command; redacted values stay redacted. */
  curl(record: RequestLogRecord, baseUrl?: string): string;
  /** Compile a filter into a predicate over list rows; throws on a bad value. */
  compile(filter: RequestLogFilter): (row: RequestLogSummary) => boolean;
};

/**
 * Dependencies the connector injects so the dashboard's routes need no core
 * boot to test: the collector, the resolved options, a development check,
 * and the optional EXPLAIN, route-listing, OpenAPI and Postman hooks.
 */
export type MountDevtoolsRoutesDeps = {
  /** The app's process list behind the built-in Processes panel. */
  processPanel?: ProcessPanel;
  /** Panels mounted after the built-in ones; an invalid panel or a reused id throws. */
  panels?: readonly DevtoolsPanel[];
  collector: DevtoolsCollector;
  /** Optional Panoptic feed, attached only in development. */
  ai?: DevtoolsAiSource;
  /** Per-turn agent traces from `@warlock.js/ai`, attached only in development. */
  agentTraces?: DevtoolsAgentTraceSource;
  options: ResolvedDevtoolsOptions;
  /** The persisted request log; absent when core is too old to have one. */
  requestLog?: DevtoolsRequestLogSource;
  isDevelopment: () => boolean;
  /** Receives one line per distinct refused request (wrong host, foreign origin, proxied). */
  warn?: (message: string) => void;
  explain?: (query: DevtoolsQuery) => Promise<unknown>;
  listRoutes?: () => DevtoolsRouteRow[] | Promise<DevtoolsRouteRow[]>;
  /** Builds the OpenAPI 3.1 document for the registered routes; injected so devtools never imports core at load. */
  getOpenApiDocument?: () => Promise<object>;
  /** Builds the Postman collection (v2.1) for the registered routes; injected so devtools never imports core at load. */
  getPostmanCollection?: () => Promise<object>;
  /** Where the dashboard runs. @default "development" */
  mode?: DevtoolsMode;
  /** The answering process; set in both modes once the insights are wired. */
  instance?: DevtoolsInstanceInfo;
  /** Resources, statistics, health, errors, logs and jobs (`src/server/insights-routes.ts`). */
  insights?: DevtoolsInsights;
  /** Production: request rows and details from stored samples instead of the collector. */
  requests?: DevtoolsRequestSource;
  /** Production: EXPLAIN by query shape id (`POST /api/queries/:shapeId/explain`). */
  explainShape?: (shapeId: string) => Promise<DevtoolsExplainResult>;
  /** Built-in tab ids to list in `GET /api/panels` (default: every built-in tab). */
  builtInPanels?: readonly string[];
};
