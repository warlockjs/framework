/**
 * Request Context Middleware
 *
 * Creates a unified context for each request using the ContextManager.
 * All framework contexts (request, storage, database) are available throughout the request lifecycle.
 */
import { trans } from "@mongez/localization";
import { DatabaseWriterValidationError } from "@warlock.js/cascade";
import { contextManager } from "@warlock.js/context";
import {
  requestContext as requestContextInstance,
  useRequestStore,
} from "../context/request-context";
import {
  BadRequestError,
  ForbiddenError,
  ResourceNotFoundError,
  ServerError,
  UnAuthorizedError,
} from "../errors";
import { type Request } from "../request";
import { type Response } from "../response";
import { type ReturnedResponse } from "./../types";

// Contexts are now registered in core/context/init-contexts.ts via initializeContexts()

/**
 * Create request store and execute middleware + handler
 *
 * Runs all registered contexts together using ContextManager.
 */
export function createRequestStore(
  request: Request<any>,
  response: Response,
): Promise<ReturnedResponse> {
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

      const output = await handler(request, response);

      request.log("Handler Executed Successfully", "success");

      request.trigger("executedAction", request.route);

      return output as ReturnedResponse;
    } catch (error: any) {
      return handleRequestError(error, response);
    }
  });
}

/**
 * Handle request errors
 * @internal
 */
function handleRequestError(error: any, response: Response): ReturnedResponse {
  if (error instanceof ResourceNotFoundError) {
    return response.notFound({
      error: error.message,
      ...error.payload,
    });
  }

  if (error instanceof UnAuthorizedError) {
    return response.unauthorized({
      error: error.message,
      ...error.payload,
    });
  }

  if (error instanceof ForbiddenError) {
    return response.forbidden({
      error: error.message,
      ...error.payload,
    });
  }

  if (error instanceof BadRequestError) {
    return response.badRequest({
      error: error.message,
      ...error.payload,
    });
  }

  if (error instanceof DatabaseWriterValidationError) {
    return response.badRequest({
      errors: error.errors,
    });
  }

  if (error instanceof ServerError) {
    return response.serverError({
      error: error.message,
      ...error.payload,
    });
  }

  console.log(error);

  return response.badRequest({
    error: error.message,
    ...error.payload,
  });
}

/**
 * Translate a keyword (uses request context for locale)
 */
export function t(keyword: string, placeholders?: any) {
  return requestContextInstance.getRequest()?.trans(keyword, placeholders) || trans(keyword);
}

/**
 * Get or compute a value from the request cache
 *
 * If the value exists in request, return it.
 * Otherwise, execute callback, store result in request, and return it.
 */
export async function fromRequest<T>(
  key: string,
  callback: (request?: Request) => Promise<T>,
): Promise<T> {
  const { request } = useRequestStore();

  if (!request) return await callback();

  if (request[key]) return request[key];

  request[key] = await callback(request);

  return request[key];
}
