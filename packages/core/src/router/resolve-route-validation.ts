import type { RequestHandlerValidation, Route } from "./types";

/**
 * The validation a route runs: the handler's own `validation`, with the
 * route's `validation` option merged over it (route keys win).
 */
export function resolveRouteValidation(
  route: Partial<Pick<Route, "handler" | "validation">>,
): RequestHandlerValidation | undefined {
  const own = route.handler?.validation;
  const routeLevel = route.validation;

  if (!routeLevel) return own;

  if (!own) return routeLevel;

  return { ...own, ...routeLevel };
}
