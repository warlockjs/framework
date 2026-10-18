// Main API
export { createCollector } from "./collector";
export type { CollectorOptions, ExporterErrorHandler } from "./collector";

// Pure projections (for advanced use / testing without a collector)
export { reportToTrace } from "./report-to-trace";
export { reportToSpan } from "./report-to-span";
export { extractSpanAttributes } from "./extract-span-attributes";
export { normalizeError } from "./normalize-error";

// Opt-in content capture
export type { ContentCaptureOptions, ContentRedactor } from "./content-capture.type";

// Process-local adapter subscriptions
export { subscribeTraces } from "./trace-subscriptions";
export type { TraceListener } from "./trace-subscriptions";
