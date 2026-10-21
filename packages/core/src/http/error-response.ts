import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppError } from "./errors";
import type { FastifyInstance } from "./server";

const appErrors = new WeakMap<FastifyReply, AppError>();

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
};

/** Return a JSON object, or undefined to retain the original response. */
export type HttpErrorResponseFormatter = (
  context: HttpErrorResponseContext,
) => Record<string, unknown> | undefined;

/**
 * Format JSON errors from both Warlock and Fastify, including early rejections.
 * HTML, files, and streams retain their own response contracts.
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
