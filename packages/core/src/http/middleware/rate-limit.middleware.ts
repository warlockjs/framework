import { normalizeIP } from "@fastify/rate-limit";
import config from "@mongez/config";
import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import { incrementSharedRateLimit, logSharedRateLimitError } from "../rate-limit-cache-store";
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
   * keyGenerator: (request) => request.locals.user?.id ?? request.ip,
   */
  keyGenerator?: (request: Request) => string;
  /**
   * Key the bucket to the signed-in user (`request.locals.user.id`). Works on
   * routes and page actions alike. `keyGenerator` wins when both are set.
   */
  key?: "user";
  /**
   * With `key: "user"`, what to do for unauthenticated requests: bucket them
   * by IP (default) or skip limiting entirely.
   */
  guests?: "ip" | "skip";
  /**
   * Override the default error message. Pass a function to build it per
   * request, e.g. to translate it into the visitor's locale.
   */
  errorMessage?: string | ((request: Request) => string);
  /**
   * Where this limiter counts: `"memory"` (this process) or `"cache"`
   * (`@warlock.js/cache`, shared by every process using the same driver).
   * Defaults to `http.rateLimit.store` when that is `"cache"`, else `"memory"`.
   */
  store?: "memory" | "cache";
  /**
   * Stable name for this limiter's shared counters. Without it, limiters are
   * told apart by the order they were created, which matches across processes
   * running the same code; set a name when limiters are created conditionally.
   */
  name?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * One limiter's in-memory buckets, in two generations.
 *
 * A bucket lives for `duration` ms from its first request. Buckets are
 * created in `current`; once `current` is at least `duration` old it becomes
 * `previous` and a fresh `current` starts, and the old `previous` is dropped
 * whole. Every bucket in it was created at least one full generation before,
 * so it had already expired: limiting is exactly what a per-key expiry gives,
 * memory holds only the keys seen in the last two windows, and no request
 * ever pays for a scan of every bucket.
 */
type BucketGenerations = {
  current: Map<string, Bucket>;
  previous: Map<string, Bucket>;
  startedAt: number;
};

const limiters = new Map<number, BucketGenerations>();
const defaultIpv6Subnet = 64;

/**
 * Each `rateLimitMiddleware()` call is its own limiter. Page actions share one
 * route, so without this two limits on the same page (say `like` and
 * `comment`) would count into one bucket.
 */
let nextLimiterId = 0;

/** Retire the current generation once it is a full window old. */
function rotateGenerations(generations: BucketGenerations, now: number, duration: number) {
  if (now - generations.startedAt < duration) return;

  generations.previous = generations.current;
  generations.current = new Map();
  generations.startedAt = now;
}

/** The live bucket for `key`, from either generation. */
function liveBucket(generations: BucketGenerations, key: string, now: number): Bucket | undefined {
  const bucket = generations.current.get(key) ?? generations.previous.get(key);

  return bucket && bucket.resetAt > now ? bucket : undefined;
}

/**
 * Number of in-memory buckets held across every limiter.
 * @internal For specs.
 */
export function memoryRateLimitBucketCount(): number {
  let total = 0;

  for (const generations of limiters.values()) {
    total += generations.current.size + generations.previous.size;
  }

  return total;
}

function resolveStore(options: RateLimitOptions): "memory" | "cache" {
  if (options.store) return options.store;

  return config.get("http.rateLimit.store") === "cache" ? "cache" : "memory";
}

/**
 * Per-route / per-group rate limit. Layers on top of `@fastify/rate-limit`'s
 * global cap (configured via `http.rateLimit`) — both run, and either can
 * 429. Use this for endpoints that need a tighter cap than the global default:
 * login, OTP request, password reset, expensive search, AI completions.
 *
 * The counter lives in-process by default, so with `N` replicas the
 * effective cap is `N × max`. Set `store: "cache"` (or `http.rateLimit.store:
 * "cache"`, which this follows) to count in `@warlock.js/cache` instead, so
 * every process sharing the cache driver counts together. A cache outage
 * fails open: the request is let through and the error is logged (at most
 * once a minute). The `null` and `file` cache drivers are refused the same
 * way: they cannot count, so the limiter lets requests through and logs why.
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
  const limiterId = nextLimiterId++;

  return async ({ request, response }) => {
    const now = Date.now();

    let userKey: string | undefined;

    if (options.key === "user" && !options.keyGenerator) {
      const id = (request.locals as { user?: { id?: unknown } } | undefined)?.user?.id;

      if (id !== undefined && id !== null && id !== "") {
        userKey = `user:${String(id)}`;
      } else if (options.guests === "skip") {
        return undefined;
      }
    }

    const ip = request.detectIp();
    const ipKey = ip ? normalizeIP(ip, defaultIpv6Subnet) : "unknown";
    const groupKey = options.keyGenerator?.(request) || userKey || ipKey;
    const cacheKey = `${limiterId}:${request.route.path}:${groupKey}`;

    let bucket: Bucket | undefined;

    if (resolveStore(options) === "cache") {
      try {
        const shared = await incrementSharedRateLimit(
          `route.${options.name ?? limiterId}.${request.route.path}`,
          groupKey,
          options.duration,
          now,
        );

        bucket = { count: shared.current, resetAt: shared.resetAt };
      } catch (error) {
        // Fail open, and report the outage at most once a minute rather
        // than once per request.
        logSharedRateLimitError(error);

        return undefined;
      }
    } else {
      let generations = limiters.get(limiterId);

      if (!generations) {
        generations = { current: new Map(), previous: new Map(), startedAt: now };
        limiters.set(limiterId, generations);
      }

      rotateGenerations(generations, now, options.duration);

      bucket = liveBucket(generations, cacheKey, now);

      if (!bucket) {
        bucket = { count: 0, resetAt: now + options.duration };
        generations.previous.delete(cacheKey);
        generations.current.set(cacheKey, bucket);
      }

      bucket.count++;
    }

    const remaining = Math.max(0, options.max - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    response.header("X-RateLimit-Limit", options.max);
    response.header("X-RateLimit-Remaining", remaining);
    response.header("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > options.max) {
      response.header("Retry-After", retryAfter);

      return response.tooManyRequests({
        error:
          (typeof options.errorMessage === "function"
            ? options.errorMessage(request)
            : options.errorMessage) || t("http.rateLimitExceeded"),
        errorCode: HttpErrorCodes.RateLimitExceeded,
      });
    }

    return undefined;
  };
}
