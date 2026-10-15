import type { ReportStatus } from "@warlock.js/ai";
import type { Trace } from "../contracts/trace.type";
import type { TraceQuery } from "./trace-query.type";

/**
 * Test whether one trace satisfies a {@link TraceQuery}. Every declared
 * filter field must match (logical AND); absent fields are ignored, so
 * an empty / undefined filter matches every trace.
 *
 * Time bounds compare against the trace's root `startedAt`, parsed to
 * an epoch once per call, inclusive on both ends. Status accepts a
 * single value or an array (membership test). Identity fields are exact
 * string equality.
 *
 * Pure — used by the store's `query` and `aggregate` so both share one
 * matching definition.
 */
export function matchTrace(trace: Trace, filter?: TraceQuery): boolean {
  if (!filter) {
    return true;
  }

  if (filter.traceId !== undefined && trace.traceId !== filter.traceId) {
    return false;
  }

  if (filter.sessionId !== undefined && trace.sessionId !== filter.sessionId) {
    return false;
  }

  if (filter.status !== undefined && !statusMatches(trace.root.status, filter.status)) {
    return false;
  }

  const startedAt = Date.parse(trace.startedAt);

  if (filter.startedAfter !== undefined && startedAt < toEpoch(filter.startedAfter)) {
    return false;
  }

  if (filter.startedBefore !== undefined && startedAt > toEpoch(filter.startedBefore)) {
    return false;
  }

  return true;
}

/**
 * Membership test for the status filter — true when `status` equals the
 * single wanted value, or is one of the wanted array.
 */
function statusMatches(status: ReportStatus, wanted: ReportStatus | ReportStatus[]): boolean {
  if (Array.isArray(wanted)) {
    return wanted.includes(status);
  }

  return status === wanted;
}

/**
 * Normalize a time bound (ISO string or `Date`) to epoch milliseconds
 * for comparison against a parsed `startedAt`.
 */
function toEpoch(bound: string | Date): number {
  if (bound instanceof Date) {
    return bound.getTime();
  }

  return Date.parse(bound);
}
