import config from "@mongez/config";
import { buildRouteRateLimit } from "./build-route-rate-limit";
import type { Route, RouteRateLimitOptions } from "./types";

/**
 * What `@fastify/rate-limit` reads from a route's `config.rateLimit`:
 * `false` exempts the route, an object gives it its own limit and bucket, and
 * `undefined` leaves it under the global policy.
 */
export type RouteRateLimitSetting = false | Record<string, unknown> | undefined;

/**
 * Whether static files (the public folder, `router.directory()` mounts and
 * `router.file()` routes) count against the global limiter. Off by default:
 * one page load fetches many assets, which would spend a client's quota on
 * files instead of pages and API calls. `http.rateLimit.staticFiles: true`
 * opts them back in.
 */
export function staticFilesAreRateLimited(): boolean {
  return config.get("http.rateLimit.staticFiles") === true;
}

/**
 * Resolve a static mount's rate-limit setting: `true` keeps it under the
 * global limiter, `false` exempts it, an object gives it its own limit, and
 * leaving it unset follows `http.rateLimit.staticFiles`.
 */
export function resolveStaticRateLimit(
  rateLimit: RouteRateLimitOptions | boolean | undefined,
): RouteRateLimitSetting {
  if (rateLimit === undefined) {
    return staticFilesAreRateLimited() ? undefined : false;
  }

  return resolveExplicitRateLimit(rateLimit);
}

/**
 * Resolve a router route's rate-limit setting, identically for production
 * registration and the development wildcard dispatcher.
 *
 * Precedence: the route's own `rateLimit` option, then a
 * `serverOptions.config.rateLimit` passed through to Fastify, then the
 * static-file default for `router.file()` routes, then the global policy.
 */
export function resolveRouteRateLimit(
  route: Pick<Route, "rateLimit" | "serverOptions" | "$staticFile">,
): RouteRateLimitSetting {
  if (route.rateLimit !== undefined) {
    return resolveExplicitRateLimit(route.rateLimit);
  }

  const passedThrough: unknown = (
    route.serverOptions?.config as { rateLimit?: unknown } | undefined
  )?.rateLimit;

  if (passedThrough === false) return false;

  if (typeof passedThrough === "object" && passedThrough !== null) {
    return passedThrough as Record<string, unknown>;
  }

  if (route.$staticFile) return resolveStaticRateLimit(undefined);

  return undefined;
}

function resolveExplicitRateLimit(
  rateLimit: RouteRateLimitOptions | boolean,
): RouteRateLimitSetting {
  if (rateLimit === true) return undefined;

  if (rateLimit === false) return false;

  return buildRouteRateLimit(rateLimit);
}
