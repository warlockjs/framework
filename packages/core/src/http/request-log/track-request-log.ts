import type { FastifyReply } from "fastify";
import { log, type LogChannel } from "@warlock.js/logger";
import type { Request } from "../request";
import { buildRequestLogRecord, type RequestLogInput } from "./build-request-log-record";
import { RequestLogFileChannel } from "./request-log-file-channel";
import { startRequestLog } from "./request-log-runtime";
import {
  beginRequestLogScope,
  endRequestLogScope,
  resolveScopeError,
  summarizeScopeQueries,
  type RequestLogScope,
} from "./request-log-scope";
import { getRequestLogConfig } from "./resolve-request-log-config";
import { shouldKeepRequestLog } from "./should-keep-request-log";
import type { RequestLogRecord, ResolvedRequestLogConfig } from "./request-log.types";

let defaultChannel: RequestLogFileChannel | undefined;
const reportedFailures = new Set<string>();

/**
 * Report a request log failure once per distinct message. The request log
 * must never break a request, and must not flood stderr when every record
 * fails the same way.
 */
function reportFailureOnce(stage: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `${stage}:${reason}`;

  if (reportedFailures.has(key)) return;

  reportedFailures.add(key);

  try {
    process.stderr.write(`[@warlock.js/core] request log ${stage} failed: ${reason}\n`);
  } catch {
    // Reporting a failure must never become one.
  }
}

/** The default JSON-lines file channel, created on first use. */
export function getDefaultRequestLogChannel(config: ResolvedRequestLogConfig): RequestLogFileChannel {
  if (!defaultChannel) {
    defaultChannel = new RequestLogFileChannel({ retention: config.retention });

    const channel = defaultChannel;

    process.once("exit", () => {
      try {
        channel.flushSync();
      } catch {
        // Nothing left to report to while exiting.
      }
    });
  }

  return defaultChannel;
}

/** The channels a record is written to. */
function resolveChannels(config: ResolvedRequestLogConfig): LogChannel[] {
  if (!config.channels) return [getDefaultRequestLogChannel(config)];

  const channels: LogChannel[] = [];

  for (const channel of config.channels) {
    if (typeof channel !== "string") {
      channels.push(channel);
      continue;
    }

    const named = log.channel(channel);

    if (named) channels.push(named);
    else reportFailureOnce("channel", new Error(`no logger channel named "${channel}"`));
  }

  return channels;
}

/**
 * Write one record to the request log's channels. Never throws, never
 * rejects: a failing channel is reported once.
 */
export function writeRequestLogRecord(
  record: RequestLogRecord,
  config: ResolvedRequestLogConfig = getRequestLogConfig(),
): void {
  try {
    const entry = {
      type: record.status >= 500 ? ("error" as const) : ("info" as const),
      module: "http",
      action: "request",
      message: `${record.method} ${record.url} ${record.status} ${record.durationMs}ms`,
      context: record as unknown as Record<string, unknown>,
    };

    for (const channel of resolveChannels(config)) {
      try {
        const result = channel.log(entry);

        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((error) => reportFailureOnce("write", error));
        }
      } catch (error) {
        reportFailureOnce("write", error);
      }
    }
  } catch (error) {
    reportFailureOnce("write", error);
  }
}

/**
 * Start tracking a request for the request log. Call once per request, and
 * only when {@link isRequestLogEnabled}. Collection runs while the request
 * does; the record is built and written after the response has been sent
 * (on the next tick after the socket closes), so it never delays the response.
 */
export function trackRequestLog(request: Request, reply: FastifyReply): void {
  const startedAt = Date.now();
  const startedPerf = performance.now();
  const id = request.id;

  try {
    void startRequestLog();
    beginRequestLogScope(id);

    reply.raw.once("close", () => {
      const scope = endRequestLogScope(id);

      setImmediate(() => finishRequestLog(request, reply, scope, startedAt, performance.now() - startedPerf));
    });
  } catch (error) {
    reportFailureOnce("track", error);
  }
}

/** Build and write the record of a finished request, if it is kept. */
export function finishRequestLog(
  request: Request,
  reply: Pick<FastifyReply, "statusCode">,
  scope: RequestLogScope | undefined,
  startedAt: number,
  durationMs: number,
): void {
  try {
    const config = getRequestLogConfig();
    const status = reply.statusCode;
    const thrown = scope?.thrown !== undefined;

    if (!shouldKeepRequestLog(config, { status, durationMs, failed: thrown })) return;

    const record = buildRequestLogRecord(
      gatherRequestLogInput(request, config, status, durationMs, startedAt, scope),
      config,
    );

    writeRequestLogRecord(record, config);
  } catch (error) {
    reportFailureOnce("record", error);
  }
}

function attempt<Value>(read: () => Value): Value | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Read everything the record needs from a finished request. Each field is read on its own so one failure loses one field. */
function gatherRequestLogInput(
  request: Request,
  config: ResolvedRequestLogConfig,
  status: number,
  durationMs: number,
  startedAt: number,
  scope: RequestLogScope | undefined,
): RequestLogInput {
  const base = attempt(() => request.baseRequest) as
    | { method?: string; url?: string }
    | undefined;
  const user = attempt(() => (request.locals as Record<string, unknown>).user) as
    | Record<string, any>
    | undefined;
  const response = attempt(() => request.response);
  const error = scope ? resolveScopeError(scope) : undefined;

  const phases = scope?.phases.length
    ? scope.phases
    : [{ name: "handler", durationMs: Math.round(durationMs * 100) / 100 }];

  return {
    id: request.id,
    traceId: request.traceId || request.id,
    startedAt,
    method: base?.method ?? attempt(() => request.route.method) ?? "",
    url: base?.url ?? "",
    ip: attempt(() => request.detectIp()),
    userAgent: attempt(() => request.userAgent),
    route: attempt(() => request.route),
    params: attempt(() => request.params),
    query: attempt(() => request.query),
    headers: attempt(() => request.headers) as Record<string, unknown> | undefined,
    body: attempt(() => request.body),
    session: user ? readSession(user) : undefined,
    status,
    durationMs,
    response: {
      size: response ? responseSize(response, config.include.response) : undefined,
      headers: attempt(() => response?.getHeaders()) as Record<string, unknown> | undefined,
      body: config.include.response ? attempt(() => response?.body) : undefined,
    },
    phases,
    logs: scope?.logs,
    queries: scope ? summarizeScopeQueries(scope) : undefined,
    error: status >= 500 || scope?.thrown ? error : undefined,
  };
}

function readSession(user: Record<string, any>): { userId?: string | number; userType?: string } {
  const userId = attempt(() => (user.id ?? user.get?.("id")) as string | number | undefined);
  const userType = attempt(() => user.userType as string | undefined);

  return {
    ...(typeof userId === "string" || typeof userId === "number" ? { userId } : {}),
    ...(typeof userType === "string" ? { userType } : {}),
  };
}

/** Bytes sent: `Content-Length` when set, else the size of a string or JSON body (only measured when the body is recorded anyway). */
function responseSize(response: Request["response"], measureBody: boolean): number | undefined {
  const header = attempt(() => response.getHeader("content-length") ?? response.getHeader("Content-Length"));
  const fromHeader = Number(header);

  if (header !== undefined && Number.isFinite(fromHeader)) return fromHeader;

  if (!measureBody) return undefined;

  const body = attempt(() => response.body);

  if (typeof body === "string") return Buffer.byteLength(body);

  if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
    const text = attempt(() => JSON.stringify(body));

    return text === undefined ? undefined : Buffer.byteLength(text);
  }

  return Buffer.isBuffer(body) ? body.length : undefined;
}

/** Test-only: forget the default channel and the failures already reported. */
export function resetRequestLogWriterForTests(): void {
  defaultChannel = undefined;
  reportedFailures.clear();
}
