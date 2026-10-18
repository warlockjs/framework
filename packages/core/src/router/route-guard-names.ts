/**
 * The names both route-guard checks share: the dev-server warning (which
 * reads registered routes) and `warlock check`'s `WL9006` (which reads the
 * source of `routes.ts` files). Keeping one definition means the two never
 * disagree about what counts as a mutating route or an auth guard.
 *
 * Side-effect free: imports nothing.
 */

/** HTTP methods that change state; a route answering one needs a guard or `public: true`. */
const MUTATING_HTTP_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Middleware named like this counts as a guard when it carries no marker. */
const GUARD_NAME_PATTERN = /auth|guard/i;

/** Whether an HTTP method (any case) mutates state: POST, PUT, PATCH or DELETE. */
export function isMutatingHttpMethod(method: string): boolean {
  return MUTATING_HTTP_METHODS.has(method.toUpperCase());
}

/** Whether a middleware name reads as an auth guard: it contains `auth` or `guard`. */
export function isAuthGuardName(name: string): boolean {
  return GUARD_NAME_PATTERN.test(name);
}
