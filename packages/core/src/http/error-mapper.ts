import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { HttpError } from "./errors";
import type { Request } from "./request";

/**
 * What an {@link HttpErrorMapper} answers for an error it recognises.
 */
export type HttpErrorMapping = {
  /**
   * The HTTP status to answer with.
   */
  status: number;
  /**
   * The message sent as `{ error }`. Defaults to the original error's message
   * for a 4xx and to the opaque `"Internal server error."` for a 5xx, so a
   * mapped server fault never echoes an internal message to the client.
   */
  message?: string;
  /**
   * Sent as `{ payload }`, like `HttpError.payload`.
   */
  payload?: unknown;
};

/**
 * `http.errorMapper`: turns an error thrown by middleware or a handler into an
 * HTTP answer. Lets domain errors that must also exist outside an HTTP process
 * (a worker, a CLI, a standalone helper) carry a status without extending
 * Core's `HttpError`.
 *
 * Called only for errors that are not already an `HttpError`. Return a
 * mapping (or an `HttpError`) to answer with it, or `undefined` to keep the
 * default handling (a model validation error keeps its configured status,
 * anything else is an opaque 500).
 *
 * @example
 * ```ts
 * errorMapper(error) {
 *   if (error instanceof DomainNotFoundError) return { status: 404 };
 *   if (error instanceof Error && typeof (error as any).status === "number") {
 *     return { status: (error as any).status };
 *   }
 * }
 * ```
 */
export type HttpErrorMapper = (
  error: unknown,
  request: Request<any>,
) => HttpErrorMapping | HttpError | null | undefined;

const OPAQUE_SERVER_ERROR = "Internal server error.";

/**
 * Run the configured `http.errorMapper` and normalise its answer to an
 * `HttpError`, or return the error unchanged when there is no mapper, the
 * error already is an `HttpError`, or the mapper declines it.
 *
 * The mapped `HttpError` keeps the original error's name and stack (for the
 * request log) and carries it as `cause`. A mapper that throws is a bug in the
 * app's mapper, not in the request: it is logged and the original error is
 * handled as if no mapper were configured.
 * @internal
 */
export function mapRequestError(error: unknown, request: Request<any>): unknown {
  if (error instanceof HttpError) {
    return error;
  }

  const mapper = config.get("http.errorMapper") as HttpErrorMapper | undefined;

  if (typeof mapper !== "function") {
    return error;
  }

  let mapping: ReturnType<HttpErrorMapper>;

  try {
    mapping = mapper(error, request);
  } catch (mapperError) {
    log.error("http", "error-mapper", mapperError, { requestId: request.id });

    return error;
  }

  if (!mapping) {
    return error;
  }

  if (mapping instanceof HttpError) {
    return mapping;
  }

  if (!Number.isInteger(mapping.status) || mapping.status < 400 || mapping.status > 599) {
    log.error(
      "http",
      "error-mapper",
      new Error(`http.errorMapper returned an invalid status: ${String(mapping.status)}`),
      { requestId: request.id },
    );

    return error;
  }

  const original = error instanceof Error ? error : undefined;
  const message =
    mapping.message ?? (mapping.status < 500 && original ? original.message : OPAQUE_SERVER_ERROR);

  const mapped = new HttpError(mapping.status, message, mapping.payload);

  if (original) {
    mapped.name = original.name;
    mapped.stack = original.stack;
    mapped.cause = original;
  }

  return mapped;
}
