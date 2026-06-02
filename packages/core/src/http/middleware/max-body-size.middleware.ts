import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import { t } from "./inject-request-context";
import { parseSize } from "./utils/parse-size";

/**
 * Reject requests whose `Content-Length` exceeds the configured cap.
 *
 * Runs before body parsing — the rejection lands as a 413 with the request
 * body still on the wire (the server reads it to completion regardless; this
 * just short-circuits the application stack). For genuine pre-read protection
 * you also want `http.bodyLimit` lowered at the Fastify level — middleware
 * is a per-route layer on top, not a replacement.
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

  return (request, response) => {
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
