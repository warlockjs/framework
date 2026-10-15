import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildRouteRateLimit } from "./build-route-rate-limit";
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

/**
 * Per-route rate limiting for the dev wildcard dispatcher.
 *
 * `@fastify/rate-limit` reads `config.rateLimit` in its `onRoute` hook, which
 * never sees individual routes behind a wildcard. It exposes the same limiter
 * as `server.rateLimit(options)`, built here from the identical
 * `buildRouteRateLimit` options `scan()` passes in production. Limiters are
 * cached per rate-limit config + method so counters survive across requests.
 */
export function createDevRateLimiter(server: FastifyInstance) {
  const limiters = new WeakMap<object, Map<string, RateLimitHandler>>();

  return async (route: Route, request: FastifyRequest, reply: FastifyReply) => {
    const options = route.rateLimit;

    const factory = (server as any).rateLimit;

    if (!options || typeof factory !== "function") {
      return undefined;
    }

    let byMethod = limiters.get(options);

    if (!byMethod) {
      byMethod = new Map();
      limiters.set(options, byMethod);
    }

    // `all` routes are expanded per verb in production, each with its own counter.
    let limiter = byMethod.get(request.method);

    if (!limiter) {
      limiter = factory.call(server, buildRouteRateLimit(options)) as RateLimitHandler;
      byMethod.set(request.method, limiter);
    }

    return limiter(request, reply);
  };
}
