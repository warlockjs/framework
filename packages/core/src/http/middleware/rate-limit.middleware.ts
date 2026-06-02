import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import type { Request } from "../request";
import { t } from "./inject-request-context";

/**
 * Options for the per-route rate limit middleware.
 */
export type RateLimitOptions = {
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

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Sweep expired buckets so the Map doesn't grow unbounded with one-shot keys
 * (rare per-user keys, dynamic path parameters in `keyGenerator`, etc.).
 * Called opportunistically, at most once per minute, not on a timer — keeps
 * the module side-effect-free for testing.
 */
let lastPruneAt = 0;

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

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
export function rateLimitMiddleware(options: RateLimitOptions): Middleware {
  return (request, response) => {
    const now = Date.now();

    if (now - lastPruneAt > 60_000) {
      pruneExpired(now);
      lastPruneAt = now;
    }

    const groupKey = options.keyGenerator?.(request) || request.detectIp() || "unknown";
    const cacheKey = `${request.route.path}:${groupKey}`;

    let bucket = buckets.get(cacheKey);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.duration };
      buckets.set(cacheKey, bucket);
    }

    bucket.count++;

    const remaining = Math.max(0, options.max - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    response.header("X-RateLimit-Limit", options.max);
    response.header("X-RateLimit-Remaining", remaining);
    response.header("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > options.max) {
      response.header("Retry-After", retryAfter);

      return response.tooManyRequests({
          error: options.errorMessage || t("http.rateLimitExceeded"),
          errorCode: HttpErrorCodes.RateLimitExceeded,
        },
      );
    }
  };
}
