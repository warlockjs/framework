import type { ReportStatus } from "@warlock.js/ai";
import type { TraceQuery } from "../store/trace-query.type";

/**
 * The set of terminal statuses a stored trace can carry. Used to keep
 * `parseQuery` from forwarding arbitrary `?status=` junk into the store.
 */
const KNOWN_STATUSES: readonly ReportStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "max-iterations",
  "awaiting-input",
  "awaiting-approval",
] as const;

/**
 * Map a request's query string onto a {@link TraceQuery} the trace store
 * understands. Every field is optional — an absent param is "don't care",
 * so an empty query string yields an empty filter that matches every
 * stored trace.
 *
 * - `traceId` / `sessionId` — passed through verbatim (first value wins).
 * - `status` — **repeatable**: `?status=failed&status=cancelled` becomes
 *   `["failed", "cancelled"]`; a single value stays a scalar. Unknown
 *   status tokens are dropped so a typo never silently matches nothing in
 *   a confusing way (it simply isn't filtered on).
 * - `startedAfter` / `startedBefore` — forwarded as ISO strings; the
 *   store accepts either a string or `Date`, and `matchTrace` does the
 *   inclusive bound comparison.
 *
 * Unknown params are ignored. Pure — takes a `URLSearchParams`, returns a
 * plain object — so it's trivially testable without a live server.
 *
 * @example
 * parseQuery(new URLSearchParams("status=failed&status=cancelled&sessionId=s1"));
 * // → { status: ["failed", "cancelled"], sessionId: "s1" }
 */
export function parseQuery(params: URLSearchParams): TraceQuery {
  const query: TraceQuery = {};

  const traceId = params.get("traceId");
  if (traceId !== null && traceId.length > 0) {
    query.traceId = traceId;
  }

  const sessionId = params.get("sessionId");
  if (sessionId !== null && sessionId.length > 0) {
    query.sessionId = sessionId;
  }

  const statuses = params
    .getAll("status")
    .filter((value): value is ReportStatus => (KNOWN_STATUSES as readonly string[]).includes(value));
  if (statuses.length === 1) {
    query.status = statuses[0];
  } else if (statuses.length > 1) {
    query.status = statuses;
  }

  const startedAfter = params.get("startedAfter");
  if (startedAfter !== null && startedAfter.length > 0) {
    query.startedAfter = startedAfter;
  }

  const startedBefore = params.get("startedBefore");
  if (startedBefore !== null && startedBefore.length > 0) {
    query.startedBefore = startedBefore;
  }

  return query;
}
