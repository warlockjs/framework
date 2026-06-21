// Main API
export { createCollector } from "./collector";

// Pure projections (for advanced use / testing without a collector)
export { reportToTrace } from "./report-to-trace";
export { reportToSpan } from "./report-to-span";
export { extractSpanAttributes } from "./extract-span-attributes";
export { normalizeError } from "./normalize-error";
