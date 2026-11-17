/**
 * URL prefixes the persistent request log never records, registered at run
 * time by framework packages that serve their own private routes (the
 * devtools production monitor registers its secret path, so neither the path
 * nor a sign-in body reaches the log files).
 */

const excludedPrefixes = new Map<string, number>();

function normalize(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, "");

  return trimmed === "" ? "" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Stops the request log from recording requests whose URL path is `prefix`
 * or starts with `prefix + "/"`. Returns a function that removes the rule.
 */
export function excludeFromRequestLog(prefix: string): () => void {
  const key = normalize(prefix);

  // The root would hide every request; refuse it.
  if (key === "") return () => undefined;

  excludedPrefixes.set(key, (excludedPrefixes.get(key) ?? 0) + 1);

  let removed = false;

  return () => {
    if (removed) return;

    removed = true;

    const count = (excludedPrefixes.get(key) ?? 1) - 1;

    if (count <= 0) excludedPrefixes.delete(key);
    else excludedPrefixes.set(key, count);
  };
}

/** Whether `urlPath` (no query string) falls under a registered exclusion. */
export function isExcludedFromRequestLog(urlPath: string): boolean {
  if (excludedPrefixes.size === 0) return false;

  for (const prefix of excludedPrefixes.keys()) {
    if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) return true;
  }

  return false;
}
