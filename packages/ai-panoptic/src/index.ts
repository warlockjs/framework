// Contracts
export type {
  CollectorContract,
  ExporterContract,
  Trace,
  TraceSpan,
  TraceSpanError,
} from "./contracts";

// Collector
export {
  createCollector,
  extractSpanAttributes,
  normalizeError,
  reportToSpan,
  reportToTrace,
} from "./collector";
export type {
  CollectorOptions,
  ContentCaptureOptions,
  ContentRedactor,
  ExporterErrorHandler,
} from "./collector";

// Store
export {
  createCacheTraceStore,
  createInMemoryTraceStore,
  emptyUsage,
  matchTrace,
  sumUsage,
} from "./store";
export type {
  CacheDriverInput,
  CacheTraceStoreHandle,
  CacheTraceStoreOptions,
  InMemoryTraceStoreOptions,
  TraceAggregate,
  TraceQuery,
  TraceStoreContract,
} from "./store";

// Exporters
export {
  consoleExporter,
  fileExporter,
  formatSpanIO,
  formatSpanLine,
  GEN_AI_ATTRIBUTES,
  langfuseExporter,
  otelExporter,
  toGenAiAttributes,
  totalCostUsd,
  walkSpans,
  WARLOCK_ATTRIBUTES,
} from "./exporters";
export type {
  AttributeValue,
  ConsoleExporterOptions,
  ConsoleLike,
  FileExporterOptions,
  LangfuseClientLike,
  LangfuseExporterOptions,
  LangfuseObservationBody,
  LangfuseObservationEndBody,
  LangfuseObservationLevel,
  LangfuseObservationLike,
  LangfuseTraceBody,
  LangfuseTraceLike,
  LangfuseUsageBody,
  OtelExporterOptions,
  TraceRecord,
} from "./exporters";

// Panoptic subscriber (the one-call entry point)
export { createPanopticMiddleware, panoptic } from "./panoptic";
export type {
  CompletedEventPayload,
  Panoptic,
  PanopticOptions,
  PanopticTarget,
} from "./panoptic";

// Evaluate — grade a trace's captured system prompt via the dashboard's
// "Evaluate system prompt" drawer action (config-gated; see DashboardOptions.evaluate).
export { evaluateSystemPrompt, extractLastSystemPrompt, findSpanById } from "./evaluate";
export type { EvaluateConfig, EvaluateVerdict } from "./evaluate";

// Dashboard — zero-dependency local server over a trace store.
export { dashboard } from "./dashboard";
export type { DashboardHandle, DashboardOptions } from "./dashboard";

// Dashboard trace-list helpers — the pure search / filter / group-by /
// cost-heatmap / prompt-version folds the inlined UI mirrors 1:1. Exported
// so the same rules drive your own trace-list views.
export {
  aggregateByType,
  filterTraces,
  groupByPrompt,
  groupBySession,
  groupByType,
  heatIntensity,
  matchesFilter,
  maxNodeCost,
  NO_PROMPT_KEY,
  NO_SESSION_KEY,
  NO_TYPE_KEY,
  percentile,
  rollupCost,
  traceCost,
  tracePromptKey,
} from "./dashboard/trace-filter";
export type {
  PromptGroup,
  SessionGroup,
  TraceFilter,
  TypeGroup,
  TypeStat,
} from "./dashboard/trace-filter";

// Config — declarative `ai.config({ panoptic })`. Exporting the type
// also loads the `declare module "@warlock.js/ai"` augmentation that
// attaches the typed `panoptic` slot onto core's `AIConfig`.
export { applyPanopticConfig } from "./config";
export type { PanopticConfig } from "./config";

// Side-effect wiring — subscribes panoptic to the core config seam so a
// bare `import "@warlock.js/ai-panoptic"` activates `ai.config({ panoptic })`.
import "./register";
