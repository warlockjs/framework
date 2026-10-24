import type { LogChannel } from "@warlock.js/logger";

/** Which requests the persistent request log keeps. */
export type RequestLogOnly = "all" | "errors" | "slow";

/** Which parts of a request the persistent request log records. */
export type RequestLogInclude = {
  /** Request headers (and, with `response`, response headers). */
  headers?: boolean;
  /** The request body, as received, before validation. */
  body?: boolean;
  /** The parsed query string. */
  query?: boolean;
  /** The matched route params. */
  params?: boolean;
  /** `{ userId, userType }` of the authenticated user. */
  session?: boolean;
  /** The response body and headers. The response size is always recorded. */
  response?: boolean;
  /** The stack of the error attached to a failed request. */
  stack?: boolean;
  /** The log entries emitted while the request ran. */
  logs?: boolean;
  /** Database query count, the slowest query and N+1 findings. */
  queries?: boolean;
  /** The timed phases of the request (route match, middleware, validation, handler). */
  phases?: boolean;
};

/**
 * `http.logging.requests`: the persistent request log. One JSON record per
 * request, written when the response has finished.
 *
 * @example
 * // http.ts
 * logging: {
 *   requests: { enabled: true, only: "errors", include: { body: true } },
 * }
 */
export type HttpRequestLogConfig = {
  /**
   * Turn the request log on.
   *
   * @default true in development, false otherwise
   */
  enabled?: boolean;
  /**
   * Where records go: logger channel names (looked up on the logger when a
   * record is written) or channel instances. Each channel receives
   * `{ type, module: "http", action: "request", message, context: record }`.
   *
   * @default a JSON-lines file channel, one file per day in `storage/logs/requests`
   */
  channels?: Array<string | LogChannel>;
  /**
   * Which requests are kept: `"all"`, only `"errors"` (5xx responses and
   * requests that threw), or only `"slow"` ones (see `slowMs`).
   *
   * @default "all" in development, "errors" when enabled elsewhere
   */
  only?: RequestLogOnly;
  /**
   * A request at least this slow (ms) counts as slow for `only: "slow"`.
   *
   * @default 1000
   */
  slowMs?: number;
  /**
   * The share of requests kept, from 0 to 1. Errors are always kept when
   * `only` includes them (`"all"` and `"errors"`).
   *
   * @default 1
   */
  sampleRate?: number;
  /** What each record contains. Defaults depend on the environment. */
  include?: RequestLogInclude;
  /**
   * Cap on each recorded body (request and response), in bytes of its JSON
   * text. A larger body is replaced by a truncated preview with a marker.
   *
   * @default 16384
   */
  maxBodyBytes?: number;
  /** Pruning of the default file channel. */
  retention?: {
    /**
     * Delete daily files older than this many days.
     *
     * @default 14
     */
    maxDays?: number;
    /**
     * Delete the oldest files while the directory is larger than this.
     *
     * @default 256
     */
    maxSizeMb?: number;
  };
};

/** `http.logging.requests` with every default applied. */
export type ResolvedRequestLogConfig = {
  enabled: boolean;
  channels: Array<string | LogChannel> | undefined;
  only: RequestLogOnly;
  slowMs: number;
  sampleRate: number;
  include: Required<RequestLogInclude>;
  maxBodyBytes: number;
  retention: { maxDays: number; maxSizeMb: number };
  /** Whether the resolved environment was production-like (stricter header allowlist). */
  strictHeaders: boolean;
};

/** One timed phase of a request. */
export type RequestLogPhase = {
  name: string;
  durationMs: number;
};

/** One log entry emitted while the request ran. */
export type RequestLogLogEntry = {
  level: string;
  module: string;
  action: string;
  message: string;
  /** Epoch milliseconds. */
  at: number;
  /** Small, already redacted context; omitted when large. */
  context?: Record<string, unknown>;
};

/** What the request did with the database. */
export type RequestLogQueries = {
  count: number;
  slowest?: { durationMs: number; query: string };
  nPlusOne?: Array<{ query: string; count: number }>;
};

/** The error behind a failed request. */
export type RequestLogError = {
  message: string;
  name: string;
  stack?: string;
  /** The pipeline stage that failed (e.g. `render`, `loader`), when known. */
  phase?: string;
  /** The source file the failure belongs to (a page file), when known. */
  file?: string;
  /** The site that served the request, in a multi-site app. */
  site?: string;
};

/**
 * The persistent request log's record: one per request, one JSON line each.
 *
 * Secrets are redacted with the logger's redaction rules, `http.logging`
 * private URL rules and the route's `logging` option apply, and uploaded
 * files appear as metadata only.
 */
export type RequestLogRecord = {
  type: "request";
  /** `request.id`. */
  id: string;
  traceId: string;
  /** When the request started, ISO 8601. */
  time: string;
  method: string;
  /** Path and query string, credential-bearing values masked. */
  url: string;
  route: { name?: string; pattern?: string };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
  session?: { userId?: string | number; userType?: string };
  ip?: string;
  status: number;
  durationMs: number;
  response: {
    /** Bytes, from `Content-Length` or the serialized body. */
    size?: number;
    headers?: Record<string, unknown>;
    body?: unknown;
  };
  phases?: RequestLogPhase[];
  logs?: RequestLogLogEntry[];
  queries?: RequestLogQueries;
  error?: RequestLogError;
};

/** The row a request list shows. */
export type RequestLogSummary = {
  id: string;
  time: string;
  method: string;
  url: string;
  /** The matched route pattern. */
  route?: string;
  routeName?: string;
  status: number;
  durationMs: number;
  error?: string;
  /** Database queries the request ran, when recorded. */
  queryCount?: number;
  /** Query shapes reported as N+1, when recorded. */
  nPlusOneCount?: number;
};

/** Filters for listing persisted requests. */
export type RequestLogFilter = {
  /** An exact status (`404`, `"404"`) or a class (`"5xx"`). */
  status?: string | number;
  /** The route name or pattern; a substring match. */
  route?: string;
  method?: string;
  /** Epoch ms, an ISO date, or a duration back from now (`"30m"`, `"1h"`, `"2d"`). */
  since?: string | number;
  /** Epoch ms or an ISO date. */
  until?: string | number;
  /** Text searched in the url and the id. */
  q?: string;
  /** Maximum rows. */
  limit?: number;
};
