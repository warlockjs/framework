import type { Trace } from "../contracts/trace.type";

/**
 * Sort traces newest-started first, in place. Each `startedAt` is parsed
 * once up front instead of twice per comparison.
 */
export function sortNewestFirst(traces: Trace[]): Trace[] {
  const startedAt = new Map<Trace, number>();

  for (const trace of traces) {
    startedAt.set(trace, Date.parse(trace.startedAt));
  }

  return traces.sort(
    (left, right) => (startedAt.get(right) ?? Number.NaN) - (startedAt.get(left) ?? Number.NaN),
  );
}
