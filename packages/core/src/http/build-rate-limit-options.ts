import type { RateLimitPluginOptions } from "@fastify/rate-limit";

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

  return options as RateLimitPluginOptions;
}
