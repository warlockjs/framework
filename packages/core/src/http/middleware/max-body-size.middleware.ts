import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import { t } from "./inject-request-context";
import { parseSize } from "./utils/parse-size";

/**
 * Reject requests whose `Content-Length` exceeds the configured cap.
 *
 * ⚠️ **This runs AFTER the body has been parsed, not before it.** Framework
 * middleware executes inside the Fastify route handler, and `@fastify/multipart`
 * is registered with `attachFieldsToBody: true` — so by the time this sees the
 * request, the bytes are already resident. It inspects `Content-Length` and
 * answers 413; it does not and cannot prevent the read.
 *
 * **So this is not a resource-exhaustion control.** For that, lower
 * `http.bodyLimit`, or set `bodyLimit` in the route's own `serverOptions` —
 * Fastify enforces those while reading. This middleware is a per-route
 * convenience for returning a consistent 413, not a replacement for either.
 *
 * The same caveat applies to `concurrencyLimit`: it bounds how many requests
 * run at once, not how many bytes are resident.
 *
 * @example
 * import { middleware } from "@warlock.js/core";
 *
 * router.post("/comments", createCommentController, {
 *   middleware: [middleware.maxBodySize("8kb")],
 * });
 *
 * router.post("/uploads", uploadController, {
 *   middleware: [middleware.maxBodySize("10mb")],
 * });
 */
export function maxBodySizeMiddleware(limit: string | number): Middleware {
  const limitBytes = parseSize(limit);

  return ({ request, response }) => {
    const contentLengthHeader = request.header("content-length");

    if (!contentLengthHeader) return;

    const contentLength = Number(contentLengthHeader);

    if (!Number.isFinite(contentLength)) return;

    if (contentLength <= limitBytes) return;

    response.header("Connection", "close");

    return response.contentTooLarge({
        error: t("http.bodyTooLarge"),
        errorCode: HttpErrorCodes.BodyTooLarge,
        limit: limitBytes,
        received: contentLength,
      },
    );
  };
}
