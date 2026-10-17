import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveRouteRateLimit } from "./resolve-route-rate-limit";
import type { Route } from "./types";

/**
 * Every verb the dev wildcard answers. Mirrors what production registers per
 * route: `head`/`options` routes are ordinary registrations there, so the dev
 * dispatcher must be reachable for them too.
 */
export const DEV_DISPATCH_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
] as const;

/**
 * The body of an unmatched request — Fastify's own default 404 shape, so an
 * unknown URL looks the same in dev as it does in production.
 */
export function buildNotFoundBody(method: string, url: string) {
  return {
    message: `Route ${method}:${url} not found`,
    error: "Not Found",
    statusCode: 404,
  };
}

type RateLimitHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

type RateLimitFactory = (options?: Record<string, unknown>) => RateLimitHandler;

/**
 * Rate limiting for the dev wildcard dispatcher, with the same outcome per
 * route as production registration.
 *
 * `@fastify/rate-limit` reads `config.rateLimit` in its `onRoute` hook, which
 * never sees individual routes behind a wildcard. The wildcard is therefore
 * registered exempt (`config.rateLimit: false`) and each matched route is
 * limited here through `server.rateLimit(options)`, resolved by the same
 * `resolveRouteRateLimit` that `scan()` uses:
 *
 * - a route's own limit gets its own limiter (cached per route + method so
 *   counters survive across requests, and `all` routes count per verb as
 *   they do in production);
 * - an exempt route (`rateLimit: false`, a passed-through
 *   `serverOptions.config.rateLimit: false`, or a static file route) is not
 *   limited;
 * - every other route shares the global limiter and its bucket, the same one
 *   the plugin's `onRoute` hook gives routes registered on Fastify directly.
 *
 * Unmatched requests are not limited, like production's not-found handler.
 */
export function createDevRateLimiter(server: FastifyInstance, globalLimit: boolean) {
  const limiters = new WeakMap<Route, Map<string, RateLimitHandler>>();
  let globalLimiter: RateLimitHandler | undefined;

  return async (route: Route, request: FastifyRequest, reply: FastifyReply) => {
    const factory = (server as unknown as { rateLimit?: RateLimitFactory }).rateLimit;

    if (typeof factory !== "function") {
      return undefined;
    }

    const setting = resolveRouteRateLimit(route);

    if (setting === false) {
      return undefined;
    }

    if (setting === undefined) {
      if (!globalLimit) return undefined;

      // No options: the plugin's own global params and store, so dev
      // requests share the bucket of routes registered on Fastify directly.
      globalLimiter ??= factory.call(server);

      return globalLimiter(request, reply);
    }

    let byMethod = limiters.get(route);

    if (!byMethod) {
      byMethod = new Map();
      limiters.set(route, byMethod);
    }

    // `all` routes are expanded per verb in production, each with its own counter.
    let limiter = byMethod.get(request.method);

    if (!limiter) {
      limiter = factory.call(server, setting);
      byMethod.set(request.method, limiter);
    }

    return limiter(request, reply);
  };
}
