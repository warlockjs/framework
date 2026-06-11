/**
 * Whether a set of granted permission patterns covers a requested permission.
 *
 * Supports three forms:
 * - exact — `"orders.update"` covers `"orders.update"`
 * - global — `"*"` covers everything (the super-grant)
 * - prefix wildcard — `"orders.*"` covers `"orders.update"` and `"orders.update.status"`
 *
 * `"orders.*"` does NOT cover the bare `"orders"` (no trailing segment).
 */
export function matchesPermission(granted: string[], permission: string): boolean {
  for (const pattern of granted) {
    if (pattern === "*" || pattern === permission) {
      return true;
    }

    // "orders.*" → prefix "orders." — matches any nested permission.
    if (pattern.endsWith(".*") && permission.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }

  return false;
}
