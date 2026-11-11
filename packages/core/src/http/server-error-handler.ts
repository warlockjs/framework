import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { environment } from "../utils/environment";
import type { FastifyInstance } from "./server";

/** The body every 5xx that reaches the server's error handler answers with. */
export const OPAQUE_SERVER_ERROR_MESSAGE = "Internal server error.";

/**
 * The status Fastify itself would answer `error` with: an explicit error
 * status on the reply wins, then the error's own `statusCode`/`status`, then 500.
 */
function resolveErrorStatus(error: unknown, reply: FastifyReply): number {
  if (reply.statusCode >= 400 && reply.statusCode < 600) return reply.statusCode;

  const candidate = error as { statusCode?: unknown; status?: unknown } | null;
  const own = candidate?.statusCode ?? candidate?.status;

  return typeof own === "number" && own >= 400 && own < 600 ? own : 500;
}

/**
 * Errors that reach Fastify directly — a returned or thrown `Error` outside
 * the request funnel (`response.serverError(error)`, a `toJSON()` that throws
 * while the handler's return value is sent, a file stream that fails, a hook
 * that throws) — get an opaque body when they are server faults: driver
 * messages, file paths and host names stay in the log. Client errors (4xx)
 * keep Fastify's own body, which names what was wrong with the request.
 *
 * @internal Registered once by `startHttpServer`.
 */
export function registerServerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // A body that failed mid-encoding must not leave its coding behind on
    // the replacement body.
    if (!reply.raw.headersSent) {
      reply.removeHeader("content-encoding");
      reply.raw.removeHeader("content-encoding");
    }

    const status = resolveErrorStatus(error, reply);

    if (status < 500) {
      // Hands the error to Fastify's default handler, which answers it.
      return reply.send(error);
    }

    const headerName = config.get("http.requestId.header", "X-Request-Id");
    const requestId = String(reply.getHeader(headerName) ?? request.id);
    const failure = error instanceof Error ? error : undefined;
    const message = failure?.message ?? String(error);

    log.error({
      module: "http",
      action: "request.response",
      message: `Request failed: ${message}`,
      context: {
        name: failure?.name || "Error",
        message,
        ...(failure?.stack === undefined ? {} : { stack: failure.stack }),
        kind: "http-request",
        requestId,
        method: request.method,
        pathname: request.url.split("?")[0],
        statusCode: status,
      },
    });

    const development = environment() === "development";

    return reply
      .code(status)
      .header("Cache-Control", "private, no-store")
      .type("application/json; charset=utf-8")
      .send({
        error: OPAQUE_SERVER_ERROR_MESSAGE,
        ...(development && { requestId }),
        ...(development && failure?.stack !== undefined && { stack: failure.stack }),
      });
  });
}
