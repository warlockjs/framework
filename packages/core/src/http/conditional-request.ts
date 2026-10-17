/**
 * HTTP conditional requests (RFC 9110 §13): entity-tag comparison and the
 * precedence of the precondition headers.
 *
 * Two comparisons exist (RFC 9110 §8.8.3.2):
 *
 * - **strong**: both tags are strong (no `W/` prefix) and their opaque tags are
 *   identical. `If-Match` uses it (§13.1.1), so a weak validator never
 *   satisfies `If-Match`.
 * - **weak**: the opaque tags are identical, whatever their `W/` prefixes.
 *   `If-None-Match` uses it (§13.1.2), so `W/"a"` matches `"a"`.
 *
 * Source: https://www.rfc-editor.org/rfc/rfc9110 (sections 8.8.3, 13.1, 13.2).
 */

/**
 * One parsed entity tag. `opaque` keeps its quotes, so `"a"` and `a` differ.
 */
export type EntityTag = {
  weak: boolean;
  opaque: string;
};

/**
 * Parse one entity tag: an optional case-sensitive `W/` prefix, then the
 * opaque tag. A value without quotes is kept as its own opaque tag so an
 * application-supplied unquoted ETag still compares with itself.
 */
export function parseEntityTag(value: string): EntityTag | undefined {
  const trimmed = value.trim();

  if (trimmed === "") return undefined;

  const weak = trimmed.startsWith("W/");
  const opaque = weak ? trimmed.slice(2) : trimmed;

  if (opaque === "") return undefined;

  return { weak, opaque };
}

/**
 * Parse an `If-Match` / `If-None-Match` value: `"*"` or a comma-separated list
 * of entity tags. A comma inside a quoted tag is part of the tag.
 */
export function parseEntityTagList(header: unknown): "*" | EntityTag[] | undefined {
  const value = Array.isArray(header) ? header.join(",") : header;

  if (typeof value !== "string" || value.trim() === "") return undefined;

  if (value.trim() === "*") return "*";

  const tags: EntityTag[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index <= value.length; index++) {
    const character = value[index];

    if (character === '"') quoted = !quoted;

    if (index === value.length || (character === "," && !quoted)) {
      const tag = parseEntityTag(value.slice(start, index));

      if (tag) tags.push(tag);

      start = index + 1;
    }
  }

  return tags;
}

/**
 * Weak comparison: the opaque tags are identical.
 */
export function weakEntityTagMatch(first: EntityTag, second: EntityTag): boolean {
  return first.opaque === second.opaque;
}

/**
 * Strong comparison: neither tag is weak and the opaque tags are identical.
 */
export function strongEntityTagMatch(first: EntityTag, second: EntityTag): boolean {
  return !first.weak && !second.weak && first.opaque === second.opaque;
}

/**
 * Whether an `If-None-Match` header matches the current entity tag, with weak
 * comparison. `*` matches any current representation.
 */
export function matchesIfNoneMatch(header: unknown, etag: string): boolean {
  const tags = parseEntityTagList(header);
  const current = parseEntityTag(etag);

  if (tags === undefined || current === undefined) return false;

  if (tags === "*") return true;

  return tags.some((tag) => weakEntityTagMatch(tag, current));
}

/**
 * Whether an `If-Match` header is satisfied by the current entity tag, with
 * strong comparison. `*` is satisfied by any current representation, so it
 * fails only when there is none (`etag` undefined).
 */
export function matchesIfMatch(header: unknown, etag: string | undefined): boolean {
  const tags = parseEntityTagList(header);

  if (tags === undefined) return true;

  if (tags === "*") return etag !== undefined;

  const current = etag === undefined ? undefined : parseEntityTag(etag);

  if (current === undefined) return false;

  return tags.some((tag) => strongEntityTagMatch(tag, current));
}

/**
 * The request headers and current validators a precondition check reads.
 */
export type ConditionalRequestInput = {
  method: string;
  /** Current entity tag, quoted, optionally `W/`-prefixed. */
  etag?: string;
  /** Current modification time. HTTP dates have second precision. */
  lastModified?: Date | number;
  ifMatch?: unknown;
  ifNoneMatch?: unknown;
  ifModifiedSince?: unknown;
  ifUnmodifiedSince?: unknown;
};

/**
 * What a precondition check decided:
 *
 * - `"proceed"`: send the normal response;
 * - `"not-modified"`: answer a GET or HEAD with 304;
 * - `"precondition-failed"`: answer with 412.
 */
export type ConditionalRequestOutcome = "proceed" | "not-modified" | "precondition-failed";

function isPresent(header: unknown): boolean {
  if (Array.isArray(header)) return header.length > 0;

  return typeof header === "string" && header.trim() !== "";
}

function toSeconds(value: Date | number): number {
  return Math.floor((value instanceof Date ? value.getTime() : value) / 1000);
}

function parseHttpDate(header: unknown): number | undefined {
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== "string") return undefined;

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

/**
 * Evaluate the precondition headers in RFC 9110 §13.2.2 order:
 *
 * 1. `If-Match` (strong comparison) — false is 412;
 * 2. otherwise `If-Unmodified-Since` — modified after the date is 412;
 * 3. `If-None-Match` (weak comparison) — a match is 304 for GET/HEAD, else 412;
 * 4. otherwise, for GET/HEAD, `If-Modified-Since` — not modified since is 304.
 *
 * An invalid date is ignored, as the RFC requires.
 */
export function evaluateConditionalRequest(
  input: ConditionalRequestInput,
): ConditionalRequestOutcome {
  const method = input.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD";

  if (isPresent(input.ifMatch)) {
    if (!matchesIfMatch(input.ifMatch, input.etag)) return "precondition-failed";
  } else if (isPresent(input.ifUnmodifiedSince) && input.lastModified !== undefined) {
    const since = parseHttpDate(input.ifUnmodifiedSince);

    if (since !== undefined && toSeconds(input.lastModified) > since) {
      return "precondition-failed";
    }
  }

  if (isPresent(input.ifNoneMatch)) {
    if (input.etag !== undefined && matchesIfNoneMatch(input.ifNoneMatch, input.etag)) {
      return safe ? "not-modified" : "precondition-failed";
    }

    return "proceed";
  }

  if (safe && isPresent(input.ifModifiedSince) && input.lastModified !== undefined) {
    const since = parseHttpDate(input.ifModifiedSince);

    if (since !== undefined && toSeconds(input.lastModified) <= since) {
      return "not-modified";
    }
  }

  return "proceed";
}
