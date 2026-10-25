/**
 * Request Context Middleware
 *
 * Creates a unified context for each request using the ContextManager.
 * All framework contexts (request, storage, database) are available throughout the request lifecycle.
 */
import { trans } from "@mongez/localization";
import { type GenericObject } from "@mongez/reinforcements";
import { DatabaseWriterValidationError } from "@warlock.js/cascade";
import { contextManager } from "@warlock.js/context";
import { log } from "@warlock.js/logger";
import config from "@mongez/config";
import { environment } from "../../utils";
import { requestContext as requestContextInstance } from "../context/request-context";
import { applyCspHeader } from "../csp";
import { runDefaultCsrfGuard } from "../csrf-default-guard";
import { setResponseAppError } from "../error-response";
import { mapRequestError } from "../error-mapper";
import { AppError, HttpError } from "../errors";
import { type Request } from "../request";
import {
  reportRequestServerError,
  type RequestErrorPhase,
} from "../report-request-error";
import { type Response } from "../response";
import { buildTracingContext, dispatchPhase, isTracingEnabled } from "../tracing";
import { type ReturnedResponse } from "./../types";

// Contexts are now registered in core/context/init-contexts.ts via initializeContexts()

/**
 * Echo `request.id` back as a response header so the FE / proxies / log
 * aggregators can correlate by the same value the server logs against.
 *
 * Reads the header name from `http.requestId.header` (default `X-Request-Id`).
 * Skip when `http.requestId.enabled` is explicitly false.
 */
function stampRequestIdHeader(request: Request, response: Response) {
  const requestIdConfig = config.get("http.requestId", {} as Record<string, any>);

  if (requestIdConfig.enabled === false) return;

  const headerName = requestIdConfig.header || "X-Request-Id";

  response.header(headerName, request.id);
}

/**
 * Create request store and execute middleware + handler
 *
 * Runs all registered contexts together using ContextManager.
 */
export function createRequestStore(
  request: Request<any>,
  response: Response,
): Promise<ReturnedResponse> {
  stampRequestIdHeader(request, response);

  // Stamped this early — before any middleware or handler runs — so the
  // header carries the SAME nonce the web layer later reads off
  // `request.nonce` for its `<script>` tags: `request.nonce` caches on first
  // read, and this is deliberately the first read. A no-op when the app
  // hasn't opted into `http.csp` (see `csp.ts`).
  applyCspHeader(request, response);

  // Build all context stores using the immutable API
  // Each context defines its own store initialization via buildStore()
  const httpContextStore = contextManager.buildStores({ request, response });

  // Run all contexts together!
  return contextManager.runAll(httpContextStore, async () => {
    // The lifecycle step in flight, so a 5xx record can name where it failed
    // when the throw site did not tag the error itself.
    let phase: RequestErrorPhase = "csrf";

    try {
      // Default CSRF-Origin guard (SECURITY, card 8a752ab2) — the earliest
      // seam common to every request, BEFORE the route's own middleware
      // (`request.runMiddleware()` below) and before any app handler, so it
      // applies even to a route that never attaches
      // `authMiddleware("cookie:*")`. See `../csrf-default-guard.ts` for the
      // full scope rule and `{ csrf: false }` exemption.
      const csrfGuardResponse = await runDefaultCsrfGuard(request, response, t, (reason) => {
        log.error(
          "http",
          "csrf-default-guard",
          new Error(`Default CSRF Origin guard refused request: ${reason}`),
        );
      });

      if (csrfGuardResponse) {
        return csrfGuardResponse as ReturnedResponse;
      }

      // Run middleware chain
      phase = "middleware";

      const result = await request.runMiddleware();

      if (result) {
        reportReturnedServerError(request, response, "middleware");

        return result as ReturnedResponse;
      }

      phase = "handler";

      // Execute route handler
      request.trigger("executingAction", request.route);

      const handler = request.getHandler();

      request.log("Executing Handler", "info");

      const tracingEnabled = isTracingEnabled();
      const handlerStartedAt = tracingEnabled ? performance.now() : 0;

      const output = await handler({ request, response });

      if (tracingEnabled) {
        dispatchPhase(buildTracingContext(request), {
          name: "handler",
          durationMs: performance.now() - handlerStartedAt,
        });
      }

      request.log("Handler Executed Successfully", "success");

      reportReturnedServerError(request, response, "handler");

      request.trigger("executedAction", request.route);

      return output as ReturnedResponse;
    } catch (thrown) {
      const error = mapRequestError(thrown, request);

      logRequestError(error, request);
      reportRequestServerError({
        error,
        thrown,
        request,
        status: resolveRequestErrorStatus(error) ?? 500,
        phase,
      });

      return handleRequestError(error, response, request);
    }
  });
}

/**
 * The HTTP status an error will be answered with, or `undefined` when it is not
 * one of the known HTTP-answerable shapes (those fall through to the opaque 500).
 *
 * Single source for `handleRequestError` and the request logger, so the rule
 * that decides the response status is the same rule that decides the log level.
 * @internal
 */
function resolveRequestErrorStatus(error: unknown): number | undefined {
  if (error instanceof HttpError || error instanceof AppError) {
    return error.status;
  }

  if (error instanceof DatabaseWriterValidationError) {
    return config.get("http.modelValidationErrorStatus", 500);
  }

  return undefined;
}

/**
 * Log a request error at the right severity. An error answered with a 4xx is an
 * expected client error (a thrown 404/409/422): one `warn` line, no stack.
 * Everything else (5xx, unknown errors) keeps the error-level entry with its stack.
 * @internal
 */
function logRequestError(error: unknown, request: Request<any>) {
  const status = resolveRequestErrorStatus(error);

  if (status !== undefined && status < 500 && error instanceof Error) {
    request.log(`${error.name}: ${error.message} (${status})`, "warn");

    return;
  }

  request.log(error, "error");
}

/**
 * A handler or middleware can answer a 5xx without throwing
 * (`return response.serverError(...)`). Leave the same single record a thrown
 * 5xx leaves. A returned 503 is the conventional "unavailable on purpose"
 * answer (maintenance, a failing readiness probe), so it is not an error.
 * @internal
 */
function reportReturnedServerError(
  request: Request<any>,
  response: Response,
  phase: RequestErrorPhase,
) {
  let status: number | undefined;

  try {
    status = response.statusCode;
  } catch {
    return;
  }

  if (typeof status !== "number" || status < 500 || status === 503) return;

  reportRequestServerError({ error: undefined, request, status, phase });
}

/**
 * The request id, added to a JSON error body in development so a failing
 * response can be matched to its log record without opening the headers.
 * Production bodies stay generic.
 * @internal
 */
function developmentRequestId(request: Request<any>): { requestId?: string } {
  return environment() === "development" && request.id ? { requestId: request.id } : {};
}

/**
 * Handle request errors
 * @internal
 */
function handleRequestError(
  error: unknown,
  response: Response,
  request: Request<any>,
): ReturnedResponse {
  // Availability floor, not a cache-policy nit: `handleRequestError` is the
  // single funnel every unhandled error in every Warlock app passes through
  // (`createRequestStore`'s catch above), and none of the branches below set
  // a `Cache-Control` header. Without this, an error response — a 500 as
  // much as a 401/403/404 carrying per-request/-user state — can be stored
  // by a shared cache or CDN and replayed to other requests/users long after
  // the condition that caused it is gone: a cached 500 becomes an outage
  // that outlives its cause; a cached 401/403 becomes a leak across users.
  // Set once, here, before any branch runs — not per branch — because the
  // branches below do not partition by status. `ResourceNotFoundError`,
  // `UnAuthorizedError`, `ForbiddenError`, `BadRequestError` and `ServerError`
  // all extend `HttpError`, so the `HttpError` branch answers for every one of
  // them, and a raw `HttpError` can carry any caller-chosen status, 4xx or 5xx.
  // Gating the floor on the eventual status would mean re-deriving that status
  // per branch — one rule meeting one form while others reach the same output.
  // Applying it once, unconditionally, is both simpler and safer.
  response.header("Cache-Control", "private, no-store");

  if (error instanceof AppError) {
    setResponseAppError(response.baseResponse, error);
    return response.setStatusCode(error.status).send({
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  if (error instanceof HttpError) {
    // 5xx HttpErrors (e.g. `ServerError`) are server faults; the caller already
    // left their single log record (`reportRequestServerError`).
    const payload: GenericObject = {
      error: error.message,
      ...developmentRequestId(request),
    };
    if (error.payload) {
      payload.payload = error.payload;
    }

    if (environment() === "development") {
      payload.stack = error.stack;
    }

    return response.setStatusCode(error.status).send(payload);
  }

  if (error instanceof DatabaseWriterValidationError) {
    const status = resolveRequestErrorStatus(error) as number;

    // A 4xx is an expected client error, already logged as a one-line warn by
    // `logRequestError`; a 5xx already left its error record with the stack.

    // A 4xx status means the app treats this as the client's fault, so the
    // field errors are useful to it; a 5xx stays opaque.
    if (status < 500) {
      return response.setStatusCode(status).send({
        errors: error.errors,
      });
    }

    return response.setStatusCode(status).send({
      error: "Internal server error.",
      ...developmentRequestId(request),
    });
  }

  // Last resort: the error matched none of the known shapes above, so the
  // client gets a deliberately opaque message. The caller already left the
  // only copy of the error (stack included) in the log, so an unrecognised
  // failure is never indistinguishable from a working server returning 500
  // (`65e476ee`).
  return response.serverError({
    error: "Internal server error.",
    ...developmentRequestId(request),
  });
}

/**
 * Translate a keyword (uses request context for locale)
 */
export function t(keyword: string, placeholders?: Record<string, unknown>): string {
  return (
    requestContextInstance.getRequest()?.trans(keyword, placeholders) ||
    trans(keyword, placeholders)
  );
}

// `fromRequest` was removed in v5. It cached computed values as dynamic
// properties on the Request instance, which only compiled because of the
// `[key: string]: any` index signature that v5 deletes (eed20184). Use
// `requestMemo(key, fn)` from `../context/request-memo` instead — same
// per-request lifetime, single-flight, and it never touches the Request object.
