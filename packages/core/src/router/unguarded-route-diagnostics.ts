/**
 * Development warning for mutating routes that nobody guarded.
 *
 * A POST/PUT/PATCH/DELETE route without auth middleware is reachable by anyone
 * who can reach the server. Sometimes that is the point (a login, a webhook, a
 * contact form) and sometimes it is a forgotten `guarded()` block. The router
 * cannot tell the two apart, so the app says which with `public: true`, and
 * `warlock dev` lists every mutating route that has neither.
 *
 * Warning only: routes register and behave exactly as before, nothing here
 * throws, and production never runs it. `warlock check` reports the same
 * routes from source as `WL9006`, before the app runs.
 */

import { log } from "@warlock.js/logger";
import { isAuthGuardName, isMutatingHttpMethod } from "./route-guard-names";
import type { Route } from "./types";

/**
 * Marks a middleware as an authentication guard. A registry symbol, so a copy
 * of core loaded twice (a linked package next to an installed one) still
 * recognises guards the other copy marked.
 */
export const AUTH_GUARD_MARKER: unique symbol = Symbol.for("warlock.js.authGuard");

/**
 * Declare whether a middleware authenticates the request. `authMiddleware()`
 * from `@warlock.js/auth` marks itself (and marks `{ optional: true }` as not
 * a guard); use this for a hand-written guard whose name does not contain
 * `auth` or `guard`.
 *
 * @example
 * export const requireApiKey = markAuthGuard(async ({ request, response }) => {
 *   if (request.headers["x-api-key"] !== env("API_KEY")) return response.unauthorized();
 * });
 */
export function markAuthGuard<T extends (...args: never[]) => unknown>(
  middleware: T,
  isGuard = true,
): T {
  Object.defineProperty(middleware, AUTH_GUARD_MARKER, {
    value: isGuard,
    configurable: true,
    enumerable: false,
  });

  return middleware;
}

/**
 * Whether a middleware authenticates the request: its {@link markAuthGuard}
 * marker when it has one, otherwise a function name containing `auth` or
 * `guard`.
 */
export function isAuthGuardMiddleware(middleware: unknown): boolean {
  if (typeof middleware !== "function") return false;

  const marker: unknown = Reflect.get(middleware, AUTH_GUARD_MARKER);
  if (typeof marker === "boolean") return marker;

  return isAuthGuardName(middleware.name);
}

/**
 * Whether an auth guard is in the route's middleware chain. `route.middleware`
 * already holds the middleware of every enclosing `router.group`, so a guard
 * declared once on a group counts for each route inside it.
 */
export function isRequiredGuardRoute(route: Pick<Route, "middleware">): boolean {
  return (route.middleware ?? []).some(isAuthGuardMiddleware);
}

/** Whether a route mutates state, is not a page route, and is neither guarded nor public. */
export function isUnguardedMutatingRoute(route: Route): boolean {
  if (!isMutatingHttpMethod(String(route.method))) return false;
  // Page actions are authorized by the page itself (`requireUser()`).
  if (route.isPage) return false;
  if (route.public === true) return false;

  return !isRequiredGuardRoute(route);
}

/** Routes already reported in this process, so an HMR reload does not repeat them. */
const reported = new Set<string>();

function routeKey(route: Route): string {
  return `${String(route.method).toUpperCase()} ${route.path}`;
}

/**
 * Warn, once per route per process, about every mutating route with no auth
 * middleware and no `public: true`. Returns the routes it reported.
 */
export function reportUnguardedMutatingRoutes(
  routes: readonly Route[],
  logger: Pick<typeof log, "warn"> = log,
): Route[] {
  const fresh = routes.filter(
    (route) => isUnguardedMutatingRoute(route) && !reported.has(routeKey(route)),
  );

  if (fresh.length === 0) return fresh;

  for (const route of fresh) reported.add(routeKey(route));

  const headline =
    fresh.length === 1
      ? "1 mutating route has no auth middleware and is not marked public."
      : `${fresh.length} mutating routes have no auth middleware and are not marked public.`;

  logger.warn({
    module: "router",
    action: "unguardedRoute",
    message:
      `${headline} Anyone who can reach the server can call them. Add auth middleware ` +
      `(e.g. register them inside a guarded group), or pass { public: true } if they are ` +
      `meant to be open:\n` +
      fresh
        .map((route) => `  - ${routeKey(route)}${route.sourceFile ? ` (${route.sourceFile})` : ""}`)
        .join("\n"),
    context: {
      routes: fresh.map((route) => ({
        method: route.method,
        path: route.path,
        name: route.name,
        sourceFile: route.sourceFile,
      })),
    },
  });

  return fresh;
}

/** Forget what was reported (tests). */
export function resetUnguardedRouteReports(): void {
  reported.clear();
}
