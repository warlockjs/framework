import type { RateLimitPluginOptions } from "@fastify/rate-limit";
import { CacheRateLimitStore } from "./rate-limit-cache-store";

/**
 * `@fastify/rate-limit` options that `http.rateLimit` passes straight through.
 */
const passthroughKeys = [
  "redis",
  "nameSpace",
  "keyGenerator",
  "ipv6Subnet",
  "skipOnError",
  "allowList",
  "continueExceeding",
  "enableDraftSpec",
  "global",
  "hook",
  "cache",
  "errorResponseBuilder",
  "addHeaders",
  "addHeadersOnExceeding",
] as const;

/**
 * Shape of the `http.rateLimit` config.
 */
export type HttpRateLimitConfig = Omit<
  Pick<RateLimitPluginOptions, (typeof passthroughKeys)[number]>,
  "ipv6Subnet"
> & {
  /**
   * IPv6 subnet size used to group client addresses.
   *
   * @default 64
   */
  ipv6Subnet?: RateLimitPluginOptions["ipv6Subnet"];
  /**
   * Set `false` to skip registering the global rate limiter.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Max requests per time window.
   *
   * @default 60
   */
  max?: number;
  /**
   * Time window in milliseconds. Alias of `timeWindow`.
   *
   * @default 60 * 1000
   */
  duration?: number;
  /**
   * Time window; takes precedence over `duration` when both are set.
   */
  timeWindow?: RateLimitPluginOptions["timeWindow"];
  /**
   * Where request counts are kept.
   *
   * - `"memory"` (default): in this process. With N processes behind a load
   *   balancer every client gets N times `max`.
   * - `"cache"`: in `@warlock.js/cache`, so every process using the same
   *   shared driver (Redis, database) counts together. Per-route
   *   `middleware.rateLimit()` follows this setting unless it sets its own
   *   `store`. Windows are fixed and aligned to the clock. A cache outage
   *   fails open on both limiters (`skipOnError` defaults to `true` here) and
   *   is logged at most once a minute. The `null` and `file` cache drivers
   *   are refused (they cannot count): requests pass and the refusal is
   *   logged the same way.
   * - a `@fastify/rate-limit` store class, passed through as is.
   *
   * `redis` still works and needs an ioredis client; the `redis` driver of
   * `@warlock.js/cache` uses node-redis, so share it through `"cache"`.
   *
   * @default "memory"
   */
  store?: "memory" | "cache" | RateLimitPluginOptions["store"];
};

/**
 * Build the `@fastify/rate-limit` plugin options from `http.rateLimit`.
 * Returns `null` when the limiter is disabled.
 */
export function buildRateLimitOptions(
  config: HttpRateLimitConfig | undefined,
): RateLimitPluginOptions | null {
  const source = config ?? {};

  if (source.enabled === false) {
    return null;
  }

  const options: Record<string, unknown> = {
    max: source.max ?? 60,
    timeWindow: source.timeWindow ?? source.duration ?? 60 * 1000,
  };

  for (const key of passthroughKeys) {
    if (source[key] !== undefined) {
      options[key] = source[key];
    }
  }

  if (source.store === "cache") {
    options["store"] = CacheRateLimitStore;

    // `@fastify/rate-limit` defaults to `skipOnError: false`, which turns
    // every request into a 500 while the cache is down. Fail open instead,
    // like the per-route middleware; the store logs the outage.
    if (source.skipOnError === undefined) {
      options["skipOnError"] = true;
    }
  } else if (typeof source.store === "function") {
    options["store"] = source.store;
  }

  return options as RateLimitPluginOptions;
}
