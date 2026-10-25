import { applyRedact, log, safeJsonStringify } from "@warlock.js/logger";
import {
  buildRequestLogSnapshot,
  resolveRequestLoggingOptions,
  type RequestLoggingOptions,
} from "../request-log-snapshot";
import { UploadedFile } from "../uploaded-file";
import type {
  RequestLogError,
  RequestLogLogEntry,
  RequestLogPhase,
  RequestLogQueries,
  RequestLogRecord,
  ResolvedRequestLogConfig,
} from "./request-log.types";

/**
 * Request headers recorded when the request log runs outside development.
 * Everything else (cookies, credentials, custom headers) is left out.
 */
export const REQUEST_LOG_HEADER_ALLOWLIST: readonly string[] = [
  "accept",
  "accept-encoding",
  "accept-language",
  "content-length",
  "content-type",
  "host",
  "origin",
  "referer",
  "traceparent",
  "user-agent",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-request-id",
];

/** Response headers recorded when the request log runs outside development. */
export const RESPONSE_LOG_HEADER_ALLOWLIST: readonly string[] = [
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "etag",
  "location",
  "x-request-id",
];

const REQUEST_HEADER_SET: ReadonlySet<string> = new Set(REQUEST_LOG_HEADER_ALLOWLIST);
const RESPONSE_HEADER_SET: ReadonlySet<string> = new Set(RESPONSE_LOG_HEADER_ALLOWLIST);
const MAX_DEPTH = 8;

/** The facts about one finished request, gathered by the caller. */
export type RequestLogInput = {
  id: string;
  traceId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  method: string;
  url: string;
  ip?: string;
  userAgent?: string;
  route?: { path?: string; name?: string; logging?: RequestLoggingOptions };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: Record<string, unknown>;
  session?: { userId?: string | number; userType?: string };
  status: number;
  durationMs: number;
  response: { size?: number; headers?: Record<string, unknown>; body?: unknown };
  phases?: RequestLogPhase[];
  logs?: RequestLogLogEntry[];
  queries?: RequestLogQueries;
  error?: RequestLogError;
};

/**
 * Build the {@link RequestLogRecord} for a finished request.
 *
 * The route's logging policy (`http.logging`, the route's `logging` option and
 * private URL rules) is applied through `buildRequestLogSnapshot` before any
 * input is copied, so an omitted body or query never reaches the record. The
 * logger's redaction runs over the whole record, uploads become
 * `{ file, mimeType }`, and bodies are capped at `maxBodyBytes`.
 */
export function buildRequestLogRecord(
  input: RequestLogInput,
  config: ResolvedRequestLogConfig,
): RequestLogRecord {
  const { include } = config;
  const snapshot = buildRequestLogSnapshot({
    id: input.id,
    method: input.method,
    url: input.url,
    ip: input.ip,
    userAgent: input.userAgent,
    query: include.query ? input.query : undefined,
    body: include.body ? input.body : undefined,
    route: input.route,
  });
  // The same policy decides whether a response body may be recorded: a route
  // that hides its request body (credentials, tokens) may well echo a secret back.
  const policy = resolveRequestLoggingOptions(input.route?.logging, input.url, input.route?.path);

  const draft: Omit<RequestLogRecord, "type" | "id" | "traceId" | "time" | "method"> = {
    url: snapshot.url,
    route: {
      ...(snapshot.name ? { name: snapshot.name } : {}),
      ...(snapshot.route ? { pattern: snapshot.route } : {}),
    },
    status: input.status,
    durationMs: round(input.durationMs),
    response: {},
  };

  if (include.params && input.params && Object.keys(input.params).length > 0) {
    draft.params = sanitizeRequestLogValue(input.params) as Record<string, unknown>;
  }

  if (snapshot.query)
    draft.query = sanitizeRequestLogValue(snapshot.query) as Record<string, unknown>;

  if (include.headers && input.headers) {
    const headers = pickHeaders(
      input.headers,
      config.strictHeaders ? REQUEST_HEADER_SET : undefined,
    );

    if (Object.keys(headers).length > 0) draft.headers = headers;
  }

  if (snapshot.body) draft.body = sanitizeRequestLogValue(snapshot.body);

  if (include.session && input.session) {
    const { userId, userType } = input.session;

    if (userId !== undefined || userType !== undefined) {
      draft.session = {
        ...(userId === undefined ? {} : { userId }),
        ...(userType === undefined ? {} : { userType }),
      };
    }
  }

  if (snapshot.ip) draft.ip = snapshot.ip;

  if (input.response.size !== undefined) draft.response.size = input.response.size;

  if (include.response) {
    if (include.headers && input.response.headers) {
      draft.response.headers = pickHeaders(
        input.response.headers,
        config.strictHeaders ? RESPONSE_HEADER_SET : undefined,
      );
    }

    if (policy.body && input.response.body !== undefined) {
      draft.response.body = sanitizeRequestLogValue(input.response.body);
    }
  }

  if (include.phases && input.phases && input.phases.length > 0) draft.phases = input.phases;
  if (include.logs && input.logs && input.logs.length > 0) draft.logs = input.logs;
  if (include.queries && input.queries) draft.queries = input.queries;

  if (input.error) {
    const { stack, ...rest } = input.error;

    draft.error = include.stack && stack !== undefined ? { ...rest, stack } : rest;
  }

  const safe = redactDraft(draft);

  if (safe.body !== undefined) safe.body = limitRequestLogBody(safe.body, config.maxBodyBytes);

  if (safe.response?.body !== undefined) {
    safe.response.body = limitRequestLogBody(safe.response.body, config.maxBodyBytes);
  }

  return {
    type: "request",
    id: input.id,
    traceId: input.traceId,
    time: new Date(input.startedAt).toISOString(),
    method: input.method,
    ...safe,
  } as RequestLogRecord;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Run the record through the logger's redaction (default denylist, configured keys and paths, registered secrets). */
function redactDraft<Draft extends Record<string, unknown>>(draft: Draft): Draft {
  const redacted = applyRedact(
    { type: "info", module: "http", action: "request", message: "", context: draft },
    log.getRedact(),
  );

  return redacted.context as Draft;
}

function pickHeaders(
  headers: Record<string, unknown>,
  allowed: ReadonlySet<string> | undefined,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();

    if (value === undefined || (allowed && !allowed.has(lower))) continue;

    output[lower] = value;
  }

  return output;
}

/**
 * A JSON-safe copy of a request or response value: uploads become
 * `{ file, mimeType }`, buffers and streams become markers, depth is bounded.
 */
export function sanitizeRequestLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof UploadedFile) return { file: value.name, mimeType: value.mimeType };

  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (typeof value === "bigint") return value.toString();

  if (typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;

  if (typeof (value as { pipe?: unknown }).pipe === "function") return "[Stream]";

  if (depth >= MAX_DEPTH) return "[Truncated: too deep]";

  if (Array.isArray(value)) return value.map((item) => sanitizeRequestLogValue(item, depth + 1));

  if (value instanceof Error) return { name: value.name, message: value.message };

  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    const clean = sanitizeRequestLogValue(item, depth + 1);

    if (clean !== undefined) output[key] = clean;
  }

  return output;
}

/**
 * Cap a body at `maxBytes` of JSON text. A larger body is replaced by the
 * first `maxBytes` characters and a marker naming the full size.
 */
export function limitRequestLogBody(value: unknown, maxBytes: number): unknown {
  const text = typeof value === "string" ? value : safeJsonStringify(value);
  const bytes = Buffer.byteLength(text);

  if (bytes <= maxBytes) return value;

  return `${text.slice(0, maxBytes)}…[truncated, ${bytes} bytes]`;
}
