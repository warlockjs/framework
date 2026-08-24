/**
 * The `[GET /products]` label that identifies a route in the request log.
 *
 * A trailing `/*` is stripped because a prefixed route is more readable as the
 * prefix it serves — `/products/*` is `/products` to anyone reading a log.
 *
 * Two things the previous one-liner (`path.replace("/*", "")`) got wrong:
 *
 * 1. The BARE catch-all `/*` became the empty string, so every unmatched
 *    request logged as `[GET ]`. The reader is looking for which route
 *    matched; a blank is the one answer that helps nobody.
 * 2. `replace` removes the FIRST occurrence wherever it sits, so a `/*` in the
 *    middle of a path would have been silently deleted from the label. Nothing
 *    declares such a route today — which is exactly why it would go unnoticed
 *    if something did.
 */
export function describeRouteForLog(method: string, path: string): string {
  return `${method} ${stripTrailingWildcard(path)}`;
}

function stripTrailingWildcard(path: string): string {
  if (!path.endsWith("/*")) return path;

  const withoutWildcard = path.slice(0, -"/*".length);

  // `/*` alone leaves nothing behind. Show the route's own declared path
  // instead of a blank.
  return withoutWildcard.length > 0 ? withoutWildcard : path;
}
