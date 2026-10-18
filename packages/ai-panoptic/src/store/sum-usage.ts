import { mergeUsage, type Usage } from "@warlock.js/ai";

/** Return an independent all-channel usage rollup, preserving hosted-tool counters. */
export function sumUsage(accumulator: Usage, next: Usage): Usage {
  const merged = emptyUsage();
  mergeUsage(merged, accumulator);
  mergeUsage(merged, next);
  return merged;
}

/** Seed an aggregation without claiming any optional counter was reported. */
export function emptyUsage(): Usage {
  return { input: 0, output: 0, total: 0 };
}
