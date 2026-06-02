import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/idempotency.middleware.d.ts
/**
 * Options for the idempotency middleware.
 */
type IdempotencyOptions = {
  /**
   * Cache TTL in seconds. Falls back to `http.idempotency.ttl`, then `86400` (24h).
   */
  ttl?: number;
  /**
   * Header name carrying the client's key. Falls back to
   * `http.idempotency.headerName`, then `"Idempotency-Key"`.
   */
  headerName?: string;
  /**
   * HTTP methods eligible for idempotency. Falls back to
   * `http.idempotency.methods`, then `["POST","PUT","PATCH","DELETE"]`.
   * Safe methods (GET/HEAD) are skipped regardless.
   */
  methods?: string[];
  /**
   * Cache driver name. Falls back to `http.idempotency.driver`, then the
   * default driver of the cache manager.
   */
  driver?: string;
};
/**
 * Dedupe non-idempotent writes by an `Idempotency-Key` header — same key,
 * same body, within TTL → cached replay; same key, different body → 422
 * `IdempotencyKeyConflict`.
 *
 * **Must run after `authMiddleware`** — the cache key is scoped per-user
 * (`idem:{userType}:{userId}:{key}`) so user A can't replay user B's key.
 * Anonymous requests fall back to IP scope.
 *
 * The replay sets `Idempotent-Replay: true` on the response for easy
 * client-side / observability detection.
 *
 * Eligible methods default to POST/PUT/PATCH/DELETE. GET/HEAD pass through
 * even with the header set (RFC: safe methods are already idempotent).
 *
 * @example
 * import { authMiddleware } from "@warlock.js/auth";
 * import { middleware } from "@warlock.js/core";
 *
 * router.post("/orders", createOrderController, {
 *   middleware: [authMiddleware("client"), middleware.idempotency()],
 * });
 *
 * router.post("/ai/summarize", summarizeController, {
 *   middleware: [
 *     authMiddleware("client"),
 *     middleware.idempotency({ ttl: 60 * 60 }), // 1h is enough for client retries
 *   ],
 * });
 */
declare function idempotencyMiddleware(options?: IdempotencyOptions): Middleware;
//#endregion
export { IdempotencyOptions, idempotencyMiddleware };
//# sourceMappingURL=idempotency.middleware.d.mts.map