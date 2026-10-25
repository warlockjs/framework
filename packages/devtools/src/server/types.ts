import type { DevtoolsAgentTraceSource } from "../sources/agent-trace-source";
import type { DevtoolsAiSource } from "../sources/ai-source";
import type { ProcessPanel } from "../process-panel";
import type { DevtoolsCollector, DevtoolsQuery, ResolvedDevtoolsOptions } from "../types";

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
 * Dependencies the connector injects so the dashboard's routes need no core
 * boot to test: the collector, the resolved options, a development check,
 * and the optional EXPLAIN, route-listing, OpenAPI and Postman hooks.
 */
export type MountDevtoolsRoutesDeps = {
  processPanel?: ProcessPanel;
  collector: DevtoolsCollector;
  /** Optional Panoptic feed, attached only in development. */
  ai?: DevtoolsAiSource;
  /** Per-turn agent traces from `@warlock.js/ai`, attached only in development. */
  agentTraces?: DevtoolsAgentTraceSource;
  options: ResolvedDevtoolsOptions;
  isDevelopment: () => boolean;
  explain?: (query: DevtoolsQuery) => Promise<unknown>;
  listRoutes?: () => DevtoolsRouteRow[] | Promise<DevtoolsRouteRow[]>;
  /** Builds the OpenAPI 3.1 document for the registered routes; injected so devtools never imports core at load. */
  getOpenApiDocument?: () => Promise<object>;
  /** Builds the Postman collection (v2.1) for the registered routes; injected so devtools never imports core at load. */
  getPostmanCollection?: () => Promise<object>;
};
