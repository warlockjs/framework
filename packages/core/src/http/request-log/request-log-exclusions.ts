/**
 * URL prefixes the persistent request log never records, registered at run
 * time by framework packages that serve their own private routes (the
 * devtools production monitor registers its secret path, so neither the path
 * nor a sign-in body reaches the log files).
 *
 * Owner: devtools 5.56 WP-2.
 */

/**
 * Stops the request log from recording requests whose URL path is `prefix`
 * or starts with `prefix + "/"`. Returns a function that removes the rule.
 */
export function excludeFromRequestLog(_prefix: string): () => void {
  throw new Error("not implemented");
}

/** Whether `urlPath` (no query string) falls under a registered exclusion. */
export function isExcludedFromRequestLog(_urlPath: string): boolean {
  return false;
}
