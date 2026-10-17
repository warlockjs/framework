import { randomUUID } from "node:crypto";
import { WarlockError } from "../../errors/warlock-error";
import {
  connectDevtools,
  type DevtoolsFetch,
  type DevtoolsRequestRecord,
} from "../devtools/devtools-client";
import {
  TRACE_SCHEMA_VERSION,
  type TraceMiddleware,
  type TraceQuery,
  type TraceReport,
  type TraceValidation,
} from "./trace-report.types";

/** The correlation header core reads and echoes by default (`http.requestId.header`). */
export const TRACE_REQUEST_ID_HEADER = "x-request-id";

/** Response bodies longer than this are cut in the report. */
export const TRACE_BODY_LIMIT = 64 * 1024;

/** Header values never printed in a report. */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

/** Inputs of {@link traceRequest}. */
export type TraceRequestOptions = {
  /** HTTP method, any case. */
  method: string;
  /** A path on the dev server (`/posts?page=2`) or an absolute URL. */
  url: string;
  /**
   * The request body. A string is sent as-is; anything else is sent as JSON
   * with `content-type: application/json` unless `headers` sets a content type.
   */
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Project root, where `.warlock/dev-server.json` is read. Default: `process.cwd()`. */
  cwd?: string;
  /** The dev server origin; overrides the recorded one. */
  serverUrl?: string;
  /** The devtools mount; overrides the recorded one (default `/__warlock`). */
  devtoolsPath?: string;
  fetch?: DevtoolsFetch;
  /** How long to wait for devtools to settle the request record. Default 5000 ms. */
  timeoutMs?: number;
  /** Poll interval while waiting for the record. Default 50 ms. */
  intervalMs?: number;
  /**
   * The correlation header the app reads and echoes (`http.requestId.header`).
   * Default `x-request-id`.
   */
  requestIdHeader?: string;
};

/** The HTTP response as the report needs it. */
export type TracedResponse = {
  status: number;
  headers: Record<string, string>;
  /** The raw response text. */
  text: string;
};

/** Inputs of {@link buildTraceReport}. */
export type BuildTraceReportInput = {
  requestId: string;
  server: string;
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: TracedResponse;
  record: DevtoolsRequestRecord;
  clientMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }

  return result;
}

/** Headers with credential values replaced by `[redacted]`. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    result[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
  }

  return result;
}

/** The response body as the report prints it: parsed JSON, else text, cut at the limit. */
export function readResponseBody(
  text: string,
  contentType: string | undefined,
): { body: unknown; truncated: boolean } {
  if (text.length === 0) return { body: null, truncated: false };

  const truncated = text.length > TRACE_BODY_LIMIT;

  if (!truncated && contentType !== undefined && /\bjson\b/i.test(contentType)) {
    try {
      return { body: JSON.parse(text), truncated: false };
    } catch {
      // Fall through to text: a body that claims JSON and is not is worth seeing as-is.
    }
  }

  return { body: truncated ? text.slice(0, TRACE_BODY_LIMIT) : text, truncated };
}

function attrNumber(attrs: Record<string, unknown> | undefined, key: string): number | null {
  const value = attrs?.[key];

  return typeof value === "number" ? value : null;
}

function attrString(attrs: Record<string, unknown> | undefined, key: string): string | null {
  const value = attrs?.[key];

  return typeof value === "string" ? value : null;
}

function validationOf(
  record: DevtoolsRequestRecord,
  status: number,
  body: unknown,
): TraceValidation {
  const phases = record.phases.filter((phase) => phase.name === "validation");

  if (phases.length === 0) {
    return { ran: false, durationMs: null, passed: null, errors: null };
  }

  const durationMs = phases.reduce((total, phase) => total + phase.durationMs, 0);
  const handlerRan = record.phases.some((phase) => phase.name === "handler");
  // A validation failure answers before the handler runs, with the configured
  // failure status (422 by default, `validation.response.status`).
  const passed = handlerRan || status < 400;
  const errors = passed ? null : isRecord(body) && "errors" in body ? body.errors : body;

  return { ran: true, durationMs, passed, errors };
}

function sumPhase(record: DevtoolsRequestRecord, name: string): { durationMs: number } | null {
  const phases = record.phases.filter((phase) => phase.name === name);

  if (phases.length === 0) return null;

  return { durationMs: phases.reduce((total, phase) => total + phase.durationMs, 0) };
}

/**
 * Assemble a {@link TraceReport} from the HTTP response and the devtools
 * record of the same request. Pure: no I/O, so it is testable on its own.
 */
export function buildTraceReport(input: BuildTraceReportInput): TraceReport {
  const { record, response } = input;
  const responseHeaders = lowerCaseKeys(response.headers);
  const { body, truncated } = readResponseBody(response.text, responseHeaders["content-type"]);

  const middleware: TraceMiddleware[] = record.phases
    .filter((phase) => phase.name === "middleware")
    .map((phase) => ({
      name: attrString(phase.attrs, "name"),
      index: attrNumber(phase.attrs, "index"),
      durationMs: phase.durationMs,
    }));

  const nPlusOneShapes = new Set(
    record.warnings.flatMap((warning) =>
      warning.type === "n+1" && typeof warning.shape === "string" ? [warning.shape] : [],
    ),
  );
  const queries: TraceQuery[] = record.queries.map((query) => ({
    ...query,
    nPlusOne: typeof query.shape === "string" && nPlusOneShapes.has(query.shape),
  }));

  const phasesMs: Record<string, number> = {};

  for (const phase of record.phases) {
    phasesMs[phase.name] = (phasesMs[phase.name] ?? 0) + phase.durationMs;
  }

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    requestId: input.requestId,
    server: input.server,
    request: {
      method: input.request.method,
      url: input.request.url,
      headers: redactHeaders(input.request.headers),
      body: input.request.body,
    },
    response: {
      status: response.status,
      headers: redactHeaders(responseHeaders),
      body,
      truncated,
    },
    route: record.route ?? null,
    error: record.error ?? null,
    timeline: {
      phases: record.phases,
      routeMatch: sumPhase(record, "route.match"),
      middleware,
      validation: validationOf(record, response.status, body),
      handler: sumPhase(record, "handler"),
    },
    queries,
    warnings: record.warnings,
    logs: record.logs,
    cache: record.cache,
    mails: record.mails,
    timings: {
      totalMs: record.durationMs ?? null,
      clientMs: input.clientMs,
      phasesMs,
    },
  };
}

/** The absolute URL a trace sends to: `url` as-is when absolute, else joined to the server origin. */
export function resolveTraceUrl(server: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  return `${server}${url.startsWith("/") ? url : `/${url}`}`;
}

/** The body and headers to send for a {@link TraceRequestOptions.body}. */
function encodeBody(
  body: unknown,
  headers: Record<string, string>,
): { payload: string | undefined; headers: Record<string, string> } {
  if (body === undefined) return { payload: undefined, headers };
  if (typeof body === "string") return { payload: body, headers };

  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");

  return {
    payload: JSON.stringify(body),
    headers: hasContentType ? headers : { ...headers, "content-type": "application/json" },
  };
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);

  return key === undefined ? undefined : headers[key];
}

/**
 * Send one request to the running dev server and return its devtools
 * timeline: middleware, validation result, handler, queries (with N+1 flags),
 * logs, cache operations, captured mails, the response and the timings.
 *
 * Devtools is reached first, so a missing dev server (`WL8008`) or devtools
 * (`WL8009`) fails before anything is sent. The request carries an
 * `x-request-id` (unless the caller set one), which core adopts as
 * `request.id` and echoes back; that id is how the devtools record is found.
 * Throws `WL5004` when devtools never recorded the request.
 *
 * @example
 * const report = await traceRequest({ method: "POST", url: "/posts", body: { title: "Hi" } });
 * report.timeline.validation.passed; // false when the body was refused
 */
export async function traceRequest(options: TraceRequestOptions): Promise<TraceReport> {
  const fetcher: DevtoolsFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const devtools = await connectDevtools({
    cwd: options.cwd,
    url: options.serverUrl,
    devtoolsPath: options.devtoolsPath,
    fetch: fetcher,
  });

  const method = options.method.toUpperCase();
  const url = resolveTraceUrl(devtools.url, options.url);
  const idHeader = (options.requestIdHeader ?? TRACE_REQUEST_ID_HEADER).toLowerCase();
  const ownId = headerValue(options.headers ?? {}, idHeader);
  const sentId = ownId ?? randomUUID();
  const base =
    ownId === undefined ? { ...options.headers, [idHeader]: sentId } : { ...options.headers };
  const { payload, headers } = encodeBody(options.body, base);

  const startedAt = performance.now();
  let response: Response;

  try {
    response = await fetcher(url, { method, headers, body: payload });
  } catch (error) {
    throw new WarlockError(
      "WL8008",
      `The dev server at ${devtools.url} did not answer ${method} ${url}: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    );
  }

  const text = await response.text();
  const clientMs = performance.now() - startedAt;
  const responseHeaders: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const requestId = responseHeaders[idHeader] ?? sentId;
  const record = await devtools.waitForRequest(requestId, {
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
  });

  if (!record) {
    throw new WarlockError(
      "WL5004",
      `Devtools holds no record of request ${requestId} (${method} ${url} answered ${response.status}). Keep http.requestId enabled so the id is echoed; paths under ${devtools.devtoolsPath} are never recorded.`,
    );
  }

  return buildTraceReport({
    requestId,
    server: devtools.url,
    request: { method, url, headers, body: options.body ?? null },
    response: { status: response.status, headers: responseHeaders, text },
    record,
    clientMs,
  });
}
