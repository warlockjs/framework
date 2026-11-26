import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppError } from "./errors";
import type { Request } from "./request";
import type { FastifyInstance } from "./server";

/**
 * The header `@warlock.js/web` sends on every client navigation, refresh and
 * JS page-action submit (web's `WARLOCK_DATA_REQUEST_HEADER`). Kept as a local
 * constant because core cannot import web; the two must stay equal.
 */
const WEB_DATA_REQUEST_HEADER = "x-warlock-data";

/**
 * Whether the request is a web data request. Presence-based, the same rule
 * web uses to choose the data reply: any non-empty value counts.
 */
function isWebDataRequest(request: FastifyRequest): boolean {
  const value = request.headers?.[WEB_DATA_REQUEST_HEADER];
  const first = Array.isArray(value) ? value[0] : value;

  return typeof first === "string" && first.length > 0;
}

const appErrors = new WeakMap<FastifyReply, AppError>();
const replyRequests = new WeakMap<FastifyReply, Request>();
const replyErrors = new WeakMap<FastifyReply, unknown>();

/** @internal Remember the Warlock request that this reply answers. */
export function setResponseRequest(reply: FastifyReply, request: Request): void {
  if (typeof reply !== "object" || reply === null) return;

  replyRequests.set(reply, request);
}

/** @internal Remember the value a handler or middleware threw for this reply. */
export function setResponseThrown(reply: FastifyReply, thrown: unknown): void {
  if (typeof reply !== "object" || reply === null) return;

  replyErrors.set(reply, thrown);
}

/** @internal Preserve the typed domain failure until the JSON formatter runs. */
export function setResponseAppError(reply: FastifyReply, error: AppError): void {
  appErrors.set(reply, error);
}

/** JSON error body and correlation data available at the transport boundary. */
export type HttpErrorResponseContext = {
  appError?: AppError;
  status: number;
  body: unknown;
  requestId: string;
  /**
   * The Warlock request this reply answers (route, method, user, headers).
   * `undefined` for replies sent before routing, such as an unmatched URL,
   * a rejected body or the global rate limit.
   */
  request?: Request;
  /** The value that was thrown when the reply came from a throw. */
  error?: unknown;
};

/** Return a JSON object, or undefined to retain the original response. */
export type HttpErrorResponseFormatter = (
  context: HttpErrorResponseContext,
) => Record<string, unknown> | undefined;

/**
 * Format JSON errors from both Warlock and Fastify, including early rejections.
 * HTML, files, and streams retain their own response contracts, and so do web
 * data replies: a reply to a request carrying `x-warlock-data` is part of the
 * web client's wire contract (a page action's 422 `{ actionData }`, the data
 * 404, loader errors on client navigation), never an API error envelope.
 * @internal
 */
export function registerErrorResponseFormatter(server: FastifyInstance): void {
  const formatter = config.get("http.errorResponse") as HttpErrorResponseFormatter | undefined;

  if (typeof formatter !== "function") {
    return;
  }

  server.addHook(
    "onSend",
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const contentType = String(reply.getHeader("content-type") ?? "");

      // A reply another handler already wrote (or is writing) cannot be
      // rewritten: touching headers now would throw ERR_HTTP_HEADERS_SENT.
      if (reply.sent || reply.raw.headersSent || reply.raw.writableEnded) {
        return payload;
      }

      // Web data replies are devalue payloads the client parses itself; an app
      // envelope in their place leaves `useActionData()` and navigation empty.
      if (isWebDataRequest(request)) {
        return payload;
      }

      if (
        reply.statusCode < 400 ||
        reply.statusCode > 599 ||
        !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType) ||
        (typeof payload !== "string" && !Buffer.isBuffer(payload))
      ) {
        return payload;
      }

      const headerName = config.get("http.requestId.header", "X-Request-Id");
      // Warlock stamps its Request.id on routed responses. Before a Warlock
      // Request exists (e.g. parsing, global rate limiting, unmatched routes),
      // use Fastify's request.id and echo that same value for correlation.
      const requestId = String(reply.getHeader(headerName) ?? request.id);

      try {
        const body: unknown = JSON.parse(payload.toString());
        const formatted = formatter({
          status: reply.statusCode,
          body,
          requestId,
          appError: appErrors.get(reply),
          request: replyRequests.get(reply),
          error: replyErrors.get(reply),
        });

        if (formatted === undefined) {
          return payload;
        }

        const serialized = JSON.stringify(formatted);

        if (serialized === undefined) {
          return payload;
        }

        if (config.get("http.requestId.enabled", true) !== false) {
          reply.header(headerName, requestId);
        }

        reply.header("Cache-Control", "private, no-store");
        reply.removeHeader("content-length");

        return serialized;
      } catch (error) {
        log.error("http", "error-response", error, { requestId });

        return payload;
      }
    },
  );
}
