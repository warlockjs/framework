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
import config from "@mongez/config";
import { environment } from "../../utils";
import { requestContext as requestContextInstance } from "../context/request-context";
import { HttpError } from "../errors";
import { type Request } from "../request";
import { type Response } from "../response";
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

  // Build all context stores using the immutable API
  // Each context defines its own store initialization via buildStore()
  const httpContextStore = contextManager.buildStores({ request, response });

  // Run all contexts together!
  return contextManager.runAll(httpContextStore, async () => {
    try {
      // Run middleware chain
      const result = await request.runMiddleware();

      if (result) {
        return result as ReturnedResponse;
      }

      // Execute route handler
      request.trigger("executingAction", request.route);

      const handler = request.getHandler();

      request.log("Executing Handler", "info");

      const output = await handler({ request, response });

      request.log("Handler Executed Successfully", "success");

      request.trigger("executedAction", request.route);

      return output as ReturnedResponse;
    } catch (error) {
      request.log(error, "error");
      return handleRequestError(error, response);
    }
  });
}

/**
 * Handle request errors
 * @internal
 */
function handleRequestError(error: unknown, response: Response): ReturnedResponse {
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

  if (error instanceof HttpError) {
    const payload: GenericObject = {
      error: error.message,
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
    return response.badRequest({
      errors: error.errors,
    });
  }

  // Last resort: the error matched none of the known shapes above, so the
  // client gets a deliberately opaque message. Without this line the error
  // itself is discarded here — no stack, no message, nothing in any log — and
  // an unrecognised failure becomes indistinguishable from a working server
  // returning 500. Never swallow the only copy of an error (`65e476ee`).
  console.error("[warlock] unhandled request error:", error);

  return response.serverError({
    error: "Internal server error.",
  });
}

/**
 * Translate a keyword (uses request context for locale)
 */
export function t(keyword: string, placeholders?: any) {
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
