import { Request } from "../request.mjs";
import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/rate-limit.middleware.d.ts
/**
 * Options for the per-route rate limit middleware.
 */
type RateLimitOptions = {
  /**
   * Max requests allowed within the time window.
   */
  max: number;
  /**
   * Time window in milliseconds.
   */
  duration: number;
  /**
   * Group key generator. Defaults to the client IP. Override to scope per-user,
   * per-organization, per-tenant, etc.
   *
   * @example
   * keyGenerator: (request) => request.user?.id ?? request.ip,
   */
  keyGenerator?: (request: Request) => string;
  /**
   * Override the default error message.
   */
  errorMessage?: string;
};
/**
 * Per-route / per-group rate limit. Layers on top of `@fastify/rate-limit`'s
 * global cap (configured via `http.rateLimit`) — both run, and either can
 * 429. Use this for endpoints that need a tighter cap than the global default:
 * login, OTP request, password reset, expensive search, AI completions.
 *
 * The counter lives in-process. With `N` replicas the effective cap is
 * `N × max`. For genuinely shared limits, configure `@fastify/rate-limit`'s
 * Redis store via `http.rateLimit` instead.
 *
 * Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on
 * every response; adds `Retry-After` (seconds) on a 429.
 *
 * @example
 * import { middleware } from "@warlock.js/core";
 * router.post("/auth/login", loginController, {
 *   middleware: [middleware.rateLimit({ max: 5, duration: 60_000 })],
 * });
 */
declare function rateLimitMiddleware(options: RateLimitOptions): Middleware;
//#endregion
export { RateLimitOptions, rateLimitMiddleware };
//# sourceMappingURL=rate-limit.middleware.d.mts.map