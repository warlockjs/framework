import { normalizeIP, type RateLimitPluginOptions } from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import { CacheRateLimitStore } from "./rate-limit-cache-store";
import { resolveClientIp } from "./trusted-proxy";

/** The plugin's own default IPv6 grouping. */
const DEFAULT_IPV6_SUBNET = 64;

/**
 * The one bucket requests share when no client address can be resolved (the
 * socket is already gone). Matches `middleware.rateLimit()`.
 */
const NO_CLIENT_ADDRESS_KEY = "unknown";

/**
 * The global limiter's default key: the client address `request.detectIp()`
 * and `middleware.rateLimit()` use (the `http.realIpHeader` value from a
 * trusted proxy, else `request.ip`), grouped like the plugin groups IPv6
 * clients (the route's `rateLimit.ipv6Subnet`, else the global one). The
 * plugin's own default reads `request.ip` only, which under
 * `trustProxy: true` is the client-writable leftmost `X-Forwarded-For` entry.
 * A request with no resolvable address (the client already disconnected)
 * falls back to the socket's remote address, then to one shared bucket.
 */
function clientKeyGenerator(globalIpv6Subnet: unknown) {
  return (request: FastifyRequest): string => {
    const routeSubnet = (
      request.routeOptions?.config as { rateLimit?: { ipv6Subnet?: unknown } } | undefined
    )?.rateLimit?.ipv6Subnet;

    const address = resolveClientIp(request);

    // `normalizeIP` throws on a non-string, which would answer the request
    // with a 500 once the client has disconnected.
    if (typeof address !== "string" || address.length === 0) return NO_CLIENT_ADDRESS_KEY;

    return normalizeIP(address, subnetOf(routeSubnet ?? globalIpv6Subnet));
  };
}

function subnetOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 128
    ? Math.trunc(value)
    : DEFAULT_IPV6_SUBNET;
}

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
   * Count static files against the global limiter: the public folder, every
   * `router.directory()` mount, `router.file()` routes and the web package's
   * built assets.
   *
   * Off by default, so one page load's asset requests do not spend the
   * client's quota; pages and API routes stay limited either way. A mount's
   * own `rateLimit` option (`router.directory(options, { rateLimit })`) wins
   * over this setting. Built-in health probes follow `http.health.rateLimit`.
   *
   * @default false
   */
  staticFiles?: boolean;
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

  // The same client address every other consumer uses; an app's own
  // `keyGenerator` (global or per route) still wins.
  if (typeof options["keyGenerator"] !== "function") {
    options["keyGenerator"] = clientKeyGenerator(source.ipv6Subnet);
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
