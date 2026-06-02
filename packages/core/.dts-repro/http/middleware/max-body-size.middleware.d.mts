import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/max-body-size.middleware.d.ts
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
declare function maxBodySizeMiddleware(limit: string | number): Middleware;
//#endregion
export { maxBodySizeMiddleware };
//# sourceMappingURL=max-body-size.middleware.d.mts.map