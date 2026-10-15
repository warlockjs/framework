// Dashboard — a zero-dependency local server (node:http) over a trace
// store. Low-level building block; the documented path is
// `ai.config({ panoptic: { dashboard } })`.

export { dashboard } from "./dashboard";
export { createRequestHandler } from "./serve";
export { parseQuery } from "./parse-query";
export { dashboardHtml } from "./ui.html";
export {
  NO_PROMPT_KEY,
  NO_SESSION_KEY,
  NO_TYPE_KEY,
  aggregateByType,
  filterTraces,
  groupByPrompt,
  groupBySession,
  groupByType,
  heatIntensity,
  matchesFilter,
  maxNodeCost,
  percentile,
  rollupCost,
  traceCost,
  tracePromptKey,
} from "./trace-filter";

export type { DashboardHandle, DashboardOptions } from "./dashboard.type";
export type { ServeConfig } from "./serve";
export type {
  PromptGroup,
  SessionGroup,
  TraceFilter,
  TypeGroup,
  TypeStat,
} from "./trace-filter";
