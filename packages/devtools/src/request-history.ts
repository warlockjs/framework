import type { RequestLogFilter, RequestLogRecord, RequestLogSummary } from "@warlock.js/core";
import type {
  DevtoolsLogEntry,
  DevtoolsRequestDetail,
  DevtoolsRequestSummary,
  DevtoolsWarning,
} from "./types";

/** The list row filters run over, from an in-memory summary. */
export function summaryToRow(summary: DevtoolsRequestSummary): RequestLogSummary {
  return {
    id: summary.id,
    time: new Date(summary.startedAt).toISOString(),
    method: summary.method,
    url: summary.path,
    ...(summary.route ? { route: summary.route } : {}),
    status: summary.status ?? 0,
    durationMs: summary.durationMs ?? 0,
  };
}

/** An in-memory-shaped list row from a persisted one. */
export function rowToSummary(row: RequestLogSummary): DevtoolsRequestSummary {
  return {
    id: row.id,
    method: row.method,
    path: row.url,
    route: row.route,
    status: row.status,
    startedAt: Date.parse(row.time),
    durationMs: row.durationMs,
    queryCount: row.queryCount ?? 0,
    warningCount: row.nPlusOneCount ?? 0,
    persisted: true,
  };
}

/**
 * Merge the live ring buffer with the persisted log, newest first, without
 * duplicates: a request in both is shown from memory (it has the full
 * timeline). Persisted rows fill in what a restart or the ring buffer's size
 * evicted.
 */
export function mergeRequestHistory(
  live: readonly DevtoolsRequestSummary[],
  persisted: readonly RequestLogSummary[],
  limit: number,
): DevtoolsRequestSummary[] {
  const seen = new Set(live.map((summary) => summary.id));
  const merged = [...live];

  for (const row of persisted) {
    if (seen.has(row.id)) continue;

    seen.add(row.id);
    merged.push(rowToSummary(row));
  }

  return merged.sort((first, second) => second.startedAt - first.startedAt).slice(0, limit);
}

const FILTER_KEYS = ["status", "route", "method", "since", "until", "q"] as const;

/** The request log filter in a `GET /api/requests` query string. */
export function filterFromQuery(query: Record<string, unknown>): RequestLogFilter {
  const filter: RequestLogFilter = {};

  for (const key of FILTER_KEYS) {
    const value = query[key];

    if (typeof value === "string" && value.trim() !== "") filter[key] = value.trim();
  }

  const limit = Number(query.limit);

  if (Number.isInteger(limit) && limit > 0) filter.limit = limit;

  return filter;
}

/** Whether a filter narrows anything. */
export function hasFilter(filter: RequestLogFilter): boolean {
  return FILTER_KEYS.some((key) => filter[key] !== undefined);
}

function toLogLevel(level: string): DevtoolsLogEntry["level"] {
  return level === "debug" || level === "info" || level === "warn" || level === "success"
    ? level
    : "error";
}

/**
 * A request detail rebuilt from a persisted record, in the shape of an
 * in-memory one: phases, logs and N+1 warnings carry over; query-by-query
 * and cache detail live only in memory, so those lists are empty. `record`
 * has everything the log kept.
 */
export function recordToDetail(record: RequestLogRecord): DevtoolsRequestDetail {
  const startedAt = Date.parse(record.time);
  const warnings: DevtoolsWarning[] = (record.queries?.nPlusOne ?? []).map((finding) => ({
    type: "n+1",
    message: `${finding.query} ran ${finding.count} times`,
    shape: finding.query,
    count: finding.count,
  }));

  return {
    id: record.id,
    method: record.method,
    path: record.url,
    route: record.route.pattern,
    status: record.status,
    startedAt,
    durationMs: record.durationMs,
    error: record.error?.message,
    phases: (record.phases ?? []).map((phase) => ({
      name: phase.name,
      startedAt,
      durationMs: phase.durationMs,
    })),
    queries: [],
    cache: [],
    logs: (record.logs ?? []).map((entry) => ({
      level: toLogLevel(entry.level),
      module: entry.module,
      action: entry.action,
      message: entry.message,
      at: entry.at,
      ...(entry.context ? { context: entry.context } : {}),
    })),
    mails: [],
    warnings,
    persisted: true,
    record,
  };
}
