import type { ReportStatus } from "@warlock.js/ai";

/**
 * Filter passed to the trace store's `query` / `aggregate`. Every field
 * is optional and ANDed together — an absent field is "don't care", so
 * an empty filter matches every stored trace. Designed so the common
 * observability questions ("everything for session X", "failed runs in
 * the last hour", "this one run") express as a single object.
 *
 * Time bounds match against each trace's root `startedAt` (the wall
 * clock the run began), inclusive on both ends, accepting either an
 * ISO-8601 string or a `Date` so callers can pass whichever they hold.
 *
 * @example
 * const failedToday = store.query({
 *   status: "failed",
 *   startedAfter: "2026-06-18T00:00:00.000Z",
 * });
 *
 * @example
 * const sessionSpend = store.aggregate({ sessionId: "session-42" });
 */
export type TraceQuery = {
  /** Exact HTTP request correlation id; absent on background traces. */
  requestId?: string;
  /**
   * Match a single trace by its `traceId` (equals the root run's
   * `runId`). The most specific filter — narrows to at most one trace.
   */
  traceId?: string;
  /**
   * Match every trace whose root carried this `sessionId`. The primary
   * grouping dimension for conversation / request-scoped rollups.
   */
  sessionId?: string;
  /**
   * Match traces whose root terminal `status` equals this value, or any
   * of these values when an array is given.
   */
  status?: ReportStatus | ReportStatus[];
  /** Inclusive lower bound on the trace's root `startedAt`. */
  startedAfter?: string | Date;
  /** Inclusive upper bound on the trace's root `startedAt`. */
  startedBefore?: string | Date;
};
