/**
 * Whether an `If-None-Match` header matches an entity tag (weak comparison,
 * RFC 9110 §13.1.2): `*`, or any listed tag equal to `etag` once `W/` is dropped.
 */
export function matchesIfNoneMatch(header: unknown, etag: string): boolean {
  if (typeof header !== "string" || header === "") return false;

  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}
