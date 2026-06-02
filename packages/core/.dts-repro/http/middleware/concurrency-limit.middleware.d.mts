import { Request } from "../request.mjs";
import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/concurrency-limit.middleware.d.ts
/**
 * Options for the concurrency limit middleware.
 */
type ConcurrencyLimitOptions = {
  /**
   * Group key generator. Defaults to `request.route.path` — i.e. the cap
   * applies across all callers of that route. Override to scope per-user
   * or per-tenant.
   *
   * @example
   * keyGenerator: (request) => `${request.route.path}:${request.user?.id ?? request.ip}`,
   */
  keyGenerator?: (request: Request) => string;
  /**
   * Override the default error message.
   */
  errorMessage?: string;
};
/**
 * Cap the number of in-flight requests against a route. Above the cap, new
 * requests get a fast 429 + `Retry-After: 1` — no queue, no timeout.
 *
 * Use for endpoints whose cost is unbounded per-request: report generation,
 * AI completions, image processing, expensive aggregations. Different from
 * `rateLimit()` — rate-limit caps requests-per-time, concurrency caps
 * in-flight requests at any instant.
 *
 * The counter is process-local. With `N` replicas the effective cap is
 * `N × max`. Document this in the route's behavior; if you need shared
 * concurrency across replicas, reach for a `@warlock.js/cache` lock instead.
 *
 * @example
 * import { middleware } from "@warlock.js/core";
 *
 * router.post("/reports/generate", reportController, {
 *   middleware: [middleware.concurrencyLimit(3)],
 * });
 *
 * router.post("/ai/summarize", summarizeController, {
 *   middleware: [
 *     middleware.concurrencyLimit(10, {
 *       keyGenerator: (request) => `ai:${request.user?.id ?? request.ip}`,
 *     }),
 *   ],
 * });
 */
declare function concurrencyLimitMiddleware(max: number, options?: ConcurrencyLimitOptions): Middleware;
//#endregion
export { ConcurrencyLimitOptions, concurrencyLimitMiddleware };
//# sourceMappingURL=concurrency-limit.middleware.d.mts.map