import type { RouteOptions } from "./types";

/**
 * Turn a route's `rateLimit` option into `@fastify/rate-limit` route config.
 * `errorMessage` is not a plugin option, so it is mapped to
 * `errorResponseBuilder`; the rest passes through unchanged.
 */
export function buildRouteRateLimit(rateLimit: NonNullable<RouteOptions["rateLimit"]>) {
  const { errorMessage, ...rest } = rateLimit;

  if (!errorMessage) {
    return rest;
  }

  return {
    ...rest,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: errorMessage,
    }),
  };
}
