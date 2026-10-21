import { router } from "@warlock.js/core";
import type { NamedApiRouteMetadata } from "../routing/named-api-routes";

/**
 * The browser route table for ONE page document: the registered named API
 * routes whose names the page may embed (`names`), minus the routes that opted
 * out with `clientVisible: false`.
 *
 * There is deliberately no "all routes" answer. A document that is asked for
 * no names embeds an empty table, and an unregistered name is simply absent, so
 * a page never carries more of the API surface than its client code reaches.
 * `undefined` only when Core's registry cannot be read, which the browser
 * reports rather than papering over.
 */
export function resolveNamedApiRoutes(
  names: readonly string[] = [],
): NamedApiRouteMetadata | undefined {
  try {
    const wanted = new Set(names);
    const result: Record<string, { path: string; method: string }> = Object.create(null);
    for (const route of router.getNamedApiRoutes()) {
      if (route.clientVisible === false || !wanted.has(route.name)) continue;
      result[route.name] = Object.freeze({ path: route.path, method: route.method });
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}
