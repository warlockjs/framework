import type { LoggingData } from "@warlock.js/logger";
import { requestLogQueryShape, type RequestLogQueryEvent } from "./query-shape";
import type {
  RequestLogError,
  RequestLogLogEntry,
  RequestLogPhase,
  RequestLogQueries,
} from "./request-log.types";

const MAX_SCOPES = 5000;
const MAX_LOGS = 200;
const MAX_PHASES = 100;
const MAX_CONTEXT_BYTES = 2048;
const MAX_MESSAGE_LENGTH = 2000;
/** The same query shape this many times in one request is reported as an N+1. */
export const REQUEST_LOG_N_PLUS_ONE_THRESHOLD = 5;

/** What is collected for one request while it runs. */
export type RequestLogScope = {
  logs: RequestLogLogEntry[];
  droppedLogs: number;
  phases: RequestLogPhase[];
  queryCount: number;
  queryShapes: Map<string, number>;
  slowest?: { durationMs: number; query: string };
  /** The error the request threw, when it did. */
  thrown?: RequestLogError;
  /** Error-level log entries that carry an error. The last one wins. */
  logged: RequestLogError[];
};

const scopes = new Map<string, RequestLogScope>();

/** Start collecting for a request. The scope is dropped by {@link endRequestLogScope}. */
export function beginRequestLogScope(id: string): void {
  if (scopes.size >= MAX_SCOPES) {
    // A request whose `close` never fired must not grow the map without bound.
    const oldest = scopes.keys().next().value;

    if (oldest !== undefined) scopes.delete(oldest);
  }

  scopes.set(id, {
    logs: [],
    droppedLogs: 0,
    phases: [],
    queryCount: 0,
    queryShapes: new Map(),
    logged: [],
  });
}

/** Stop collecting for a request and hand back what was collected. */
export function endRequestLogScope(id: string): RequestLogScope | undefined {
  const scope = scopes.get(id);

  scopes.delete(id);

  return scope;
}

/** Whether a request is being collected. */
export function hasRequestLogScope(id: string): boolean {
  return scopes.has(id);
}

/** Add a log entry emitted during the request. */
export function recordRequestLogEntry(id: string, entry: RequestLogLogEntry): void {
  const scope = scopes.get(id);

  if (!scope) return;

  if (scope.logs.length >= MAX_LOGS) {
    scope.droppedLogs += 1;
    return;
  }

  scope.logs.push(entry);
}

/** Add a timed phase of the request. */
export function recordRequestLogPhase(id: string, phase: RequestLogPhase): void {
  const scope = scopes.get(id);

  if (scope && scope.phases.length < MAX_PHASES) scope.phases.push(phase);
}

/** Count a database query of the request. */
export function recordRequestLogQuery(id: string, event: RequestLogQueryEvent): void {
  const scope = scopes.get(id);

  if (!scope) return;

  const shape = requestLogQueryShape(event);

  scope.queryCount += 1;
  scope.queryShapes.set(shape, (scope.queryShapes.get(shape) ?? 0) + 1);

  if (!scope.slowest || event.durationMs > scope.slowest.durationMs) {
    scope.slowest = { durationMs: Math.round(event.durationMs * 100) / 100, query: shape };
  }
}

/**
 * Attach the error a request failed with. Pass an `Error`, or the error
 * record Core and `@warlock.js/web` already built (message, name, stack,
 * phase, file, site). A thrown error wins over one that was only logged.
 */
export function recordRequestLogError(id: string, error: unknown): void {
  const scope = scopes.get(id);

  if (!scope) return;

  scope.thrown = toRequestLogError(error);
}

/** Attach an error that was logged (not thrown) while the request ran. */
export function recordLoggedRequestLogError(id: string, error: RequestLogError): void {
  scopes.get(id)?.logged.push(error);
}

/** The error to attach to the record: the thrown one, else the last logged one. */
export function resolveScopeError(scope: RequestLogScope): RequestLogError | undefined {
  return scope.thrown ?? scope.logged[scope.logged.length - 1];
}

/** The `queries` part of the record, or `undefined` when no query ran. */
export function summarizeScopeQueries(scope: RequestLogScope): RequestLogQueries | undefined {
  if (scope.queryCount === 0) return undefined;

  const nPlusOne = [...scope.queryShapes]
    .filter(([, count]) => count >= REQUEST_LOG_N_PLUS_ONE_THRESHOLD)
    .map(([query, count]) => ({ query, count }))
    .sort((first, second) => second.count - first.count);

  return {
    count: scope.queryCount,
    ...(scope.slowest ? { slowest: scope.slowest } : {}),
    ...(nPlusOne.length > 0 ? { nPlusOne } : {}),
  };
}

/** An error record from anything that can be thrown or already is such a record. */
export function toRequestLogError(error: unknown): RequestLogError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name || "Error",
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (error !== null && typeof error === "object") {
    const record = error as Record<string, unknown>;

    if (typeof record.message === "string") {
      return {
        message: record.message,
        name: typeof record.name === "string" ? record.name : "Error",
        ...(typeof record.stack === "string" ? { stack: record.stack } : {}),
        ...(typeof record.phase === "string" ? { phase: record.phase } : {}),
        ...(typeof record.file === "string" ? { file: record.file } : {}),
        ...(typeof record.site === "string" ? { site: record.site } : {}),
      };
    }
  }

  return { message: String(error), name: "Error" };
}

/** The log entry as the request log stores it. */
export function toRequestLogEntry(data: LoggingData, now = Date.now()): RequestLogLogEntry {
  const message =
    data.message instanceof Error ? data.message.message : stringifyMessage(data.message);
  const entry: RequestLogLogEntry = {
    level: data.type,
    module: data.module,
    action: data.action,
    message: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message,
    at: now,
  };
  const context = compactContext(data.context);

  if (context) entry.context = context;

  return entry;
}

/**
 * The error carried by an error-level log entry: the `Error` itself, or a
 * context shaped like the page error record (`name`, `message`, `stack`,
 * `phase`, `file`, `site`). `undefined` for any other entry.
 */
export function errorFromLogData(data: LoggingData): RequestLogError | undefined {
  if (data.type !== "error" && data.type !== "fatal") return undefined;

  if (data.message instanceof Error) return toRequestLogError(data.message);

  const context = data.context;

  if (context && typeof context.stack === "string") {
    return toRequestLogError({
      ...context,
      message: typeof context.message === "string" ? context.message : stringifyMessage(data.message),
    });
  }

  return undefined;
}

function stringifyMessage(message: unknown): string {
  if (typeof message === "string") return message;

  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}

/** The context without the request snapshot, or `undefined` when empty or large. */
function compactContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const { request: _request, ...rest } = context;

  if (Object.keys(rest).length === 0) return undefined;

  try {
    const text = JSON.stringify(rest);

    if (text.length > MAX_CONTEXT_BYTES) return undefined;

    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Test-only: drop every scope. */
export function resetRequestLogScopesForTests(): void {
  scopes.clear();
}
