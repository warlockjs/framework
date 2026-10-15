// Main API
export { createCacheTraceStore } from "./cache-trace-store";
export { createInMemoryTraceStore } from "./in-memory-trace-store";

// Pure helpers (for advanced use / testing)
export { matchTrace } from "./match-trace";
export { emptyUsage, sumUsage } from "./sum-usage";

// Types
export type {
  CacheDriverInput,
  CacheTraceStoreHandle,
  CacheTraceStoreOptions,
} from "./cache-trace-store";
export type { InMemoryTraceStoreOptions } from "./in-memory-trace-store";
export type { TraceStoreContract } from "./trace-store.contract";
export type { TraceQuery } from "./trace-query.type";
export type { TraceAggregate } from "./trace-aggregate.type";
