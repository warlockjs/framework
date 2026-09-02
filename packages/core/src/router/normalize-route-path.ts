import concatRoute from "@mongez/concat-route";

/**
 * Normalize route path segments into the canonical path the router serves.
 *
 * This is the ONE definition of a route path's canonical form. `Router.add`
 * calls it to join a group prefix onto a route path, and that call is the only
 * reason a bare `"*"` (the not-found catch-all) is registered — and therefore
 * matched, listed and diffed — as `"/*"`.
 *
 * Anything that PREDICTS or RECORDS a route path outside registration has to
 * call this same function. The build-time page-route manifest is the case that
 * forced it into existence: it is derived from a filesystem scan that never
 * registers a route, so before it normalized here it persisted `"*"` while the
 * running router held `"/*"`, and `warlock routes:diff` reported a route as
 * changed immediately after a successful build.
 *
 * Keeping one implementation is what lets the diff stay a STRICT string
 * comparison instead of teaching every consumer which spellings are secretly
 * equivalent.
 *
 * @example normalizeRoutePath("*") // "/*"
 * @example normalizeRoutePath("/users/", "/:id") // "/users/:id"
 * @example normalizeRoutePath("") // "/"
 */
export function normalizeRoutePath(...segments: string[]): string {
  return concatRoute(...segments);
}
