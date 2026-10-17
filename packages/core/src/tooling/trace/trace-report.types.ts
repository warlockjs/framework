import type { DevtoolsPhaseRecord } from "../devtools/devtools-client";

/** The `schemaVersion` of {@link TraceReport}. Fields are only added within a version. */
export const TRACE_SCHEMA_VERSION = 1;

/** One middleware run, in the order it ran. */
export type TraceMiddleware = {
  name: string | null;
  index: number | null;
  durationMs: number;
};

/** What the route's validation did. */
export type TraceValidation = {
  /** Whether a validation phase ran (the route declares a schema or a `validate` function). */
  ran: boolean;
  durationMs: number | null;
  /**
   * `true` when validation ran and the handler ran after it (or the response
   * succeeded); `false` when it ran, the handler did not, and the response is
   * an error; `null` when validation did not run.
   */
  passed: boolean | null;
  /** The response body's `errors` (or the whole body) when validation failed; otherwise `null`. */
  errors: unknown;
};

/** One recorded query, with its N+1 flag. */
export type TraceQuery = Record<string, unknown> & {
  /** `true` when the query's shape is one devtools reported as an N+1. */
  nPlusOne: boolean;
};

/** What `warlock trace --json` prints and `traceRequest()` returns. */
export type TraceReport = {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  /** The request id the server used (the `x-request-id` it echoed). */
  requestId: string;
  /** The dev server origin the request went to. */
  server: string;
  request: {
    method: string;
    url: string;
    /** Sent headers; `authorization`, `cookie` and `proxy-authorization` values read `[redacted]`. */
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    /** Parsed JSON when the content type is JSON, else text; `null` for an empty body. */
    body: unknown;
    /** Whether `body` was cut to the first 64 KiB. */
    truncated: boolean;
  };
  /** The matched route pattern, e.g. `/posts/:id`, or `null`. */
  route: string | null;
  /** The error devtools recorded for the request, or `null`. */
  error: string | null;
  timeline: {
    /** Every recorded phase in the order it was recorded. */
    phases: DevtoolsPhaseRecord[];
    routeMatch: { durationMs: number } | null;
    middleware: TraceMiddleware[];
    validation: TraceValidation;
    handler: { durationMs: number } | null;
  };
  queries: TraceQuery[];
  /** Devtools warnings for the request (`{ type: "n+1", message, shape, count, caller }`). */
  warnings: Record<string, unknown>[];
  logs: Record<string, unknown>[];
  cache: Record<string, unknown>[];
  /** Ids of mails captured during the request. */
  mails: string[];
  timings: {
    /** The server-side duration devtools measured, or `null` while unsettled. */
    totalMs: number | null;
    /** The round trip measured by the client. */
    clientMs: number;
    /** Total time per phase name. */
    phasesMs: Record<string, number>;
  };
};
