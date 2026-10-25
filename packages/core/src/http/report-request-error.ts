/**
 * The one error record a failed HTTP request leaves in the log.
 *
 * Every 5xx the core HTTP layer answers (a throw from a route middleware, from
 * the validation step, from a controller, or a 5xx the handler returned without
 * throwing) goes through {@link reportRequestServerError}, which writes a single
 * `error`-level record per request. It has the same shape as the web package's
 * page-failure record (`module`, `action: "<scope>.<phase>"`, and a context with
 * `name`, `message`, `stack`, `phase`, `file`, `routePath`, `routeName`,
 * `method`, `pathname`, `requestId`, `statusCode`), plus the facts only an HTTP
 * route has: the `handler` and, when the failure came out of a middleware, its
 * `middleware` name.
 *
 * A 4xx is the client's affair and is never reported here.
 */
import { log } from "@warlock.js/logger";
import type { Request } from "./request";

/** Where in the request lifecycle a failure happened. */
export type RequestErrorPhase = "csrf" | "middleware" | "validation" | "handler" | "response";

/** What a throw site remembers about a failure on its way up. */
export type RequestErrorOrigin = {
  phase: RequestErrorPhase;
  /** Name of the middleware that threw, when `phase` is `"middleware"`. */
  middleware?: string;
};

const ORIGIN_TAG = Symbol.for("warlock.http.errorOrigin");

/**
 * Remember where `thrown` came from, unless an inner stage already did. A
 * primitive or frozen throw simply keeps the caller's own phase.
 */
export function tagRequestError(thrown: unknown, origin: RequestErrorOrigin): void {
  if (typeof thrown !== "object" || thrown === null) return;

  const record = thrown as Record<PropertyKey, unknown>;

  try {
    if (record[ORIGIN_TAG] === undefined) record[ORIGIN_TAG] = origin;
  } catch {
    // A frozen error keeps the phase the reporter derives itself.
  }
}

/** The origin a throw site tagged `thrown` with, if any. */
export function readRequestErrorOrigin(thrown: unknown): RequestErrorOrigin | undefined {
  if (typeof thrown !== "object" || thrown === null) return undefined;

  const origin = (thrown as Record<PropertyKey, unknown>)[ORIGIN_TAG];

  return typeof origin === "object" && origin !== null ? (origin as RequestErrorOrigin) : undefined;
}

/** Requests that already left their record: one failure, one line. */
const reportedRequests = new WeakSet<object>();

export type ReportRequestErrorInput = {
  /** The error as answered (after `http.errorMapper`), or `undefined` for a returned 5xx. */
  error: unknown;
  /** The error as originally thrown; its origin tag wins over `error`'s. */
  thrown?: unknown;
  request: Request<any>;
  status: number;
  /** The phase to report when nothing tagged the error. */
  phase: RequestErrorPhase;
};

function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function describeHandler(request: Request<any>): string | undefined {
  const handler = safely(() => request.route?.handler);

  if (typeof handler !== "function") return undefined;

  return handler.name?.replace(/^bound /, "").trim() || "(anonymous)";
}

function pathnameOf(request: Request<any>): string | undefined {
  const url = safely(() => request.path);

  return typeof url === "string" ? url.split("?")[0] : undefined;
}

/**
 * Writes the request's 5xx record. Never throws, and writes at most once per
 * request. With no log channel configured the failure still reaches the
 * terminal through `console.error`.
 */
export function reportRequestServerError(input: ReportRequestErrorInput): void {
  const { error, request, status } = input;

  if (status < 500) return;
  if (typeof request === "object" && request !== null) {
    if (reportedRequests.has(request)) return;

    reportedRequests.add(request);
  }

  try {
    const origin = readRequestErrorOrigin(input.thrown) ?? readRequestErrorOrigin(error);
    const phase = origin?.phase ?? input.phase;
    const failure = error instanceof Error ? error : undefined;
    const message =
      failure?.message ??
      (error === undefined
        ? `The response status is ${status} but nothing threw.`
        : safely(() => String(error)) ?? "An unexpected error occurred.");
    const route = safely(() => request.route);
    const routeName = route?.name;
    const file = route?.sourceFile || undefined;
    const handler = describeHandler(request);
    const pathname = pathnameOf(request);

    log.error({
      module: "http",
      action: `request.${phase}`,
      message: `Request failed: ${message}`,
      context: {
        name: failure?.name || "Error",
        message,
        ...(failure?.stack === undefined ? {} : { stack: failure.stack }),
        phase,
        kind: "http-request",
        ...(file === undefined ? {} : { file }),
        ...(route?.path === undefined ? {} : { routePath: route.path }),
        ...(routeName === undefined ? {} : { routeName }),
        ...(handler === undefined ? {} : { handler }),
        ...(origin?.middleware === undefined ? {} : { middleware: origin.middleware }),
        requestId: request.id,
        method: safely(() => request.method),
        ...(pathname === undefined ? {} : { pathname }),
        statusCode: status,
      },
    });

    // With no log channel configured the record above goes nowhere; the
    // terminal still gets the failure.
    if (log.channels.every((channel) => channel.passive)) {
      console.error(
        `[http] request failed (requestId: ${request.id}, phase: ${phase}):`,
        error ?? message,
      );
    }
  } catch (reportFailure) {
    console.error("[http] could not write the request error record:", reportFailure);
  }
}
