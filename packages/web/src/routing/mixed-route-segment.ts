/**
 * Mixed page-route segments — the one pure definition of a page route segment
 * that holds several `:param`s, static text between or around them, or a
 * terminal wildcard with a name. Everything that reads page route paths
 * (grammar, parameter parser, href interpolation, the client matcher and the
 * server fallback matcher) goes through this module, so they agree on what a
 * segment means and how an ambiguous URL segment splits.
 *
 * Shapes: `/:type-for-:purpose`, `/near/:lat-:lng`, `/pre-:id`, `/:name.png`
 * (mixed segments), and `/files/*rest` (a named terminal wildcard).
 *
 * SPLITTING RULE — the router splits a URL segment the way a greedy regular
 * expression would: `:type-for-:purpose` against `a-for-b-for-c` gives
 * `type = "a-for-b"` and `purpose = "c"`, so every param but the last takes as
 * much as it can while the static text after it still matches. A param may be
 * empty (`/a-for-` gives `purpose = ""`) and never spans a `/`. This is what
 * find-my-way, the router behind the server, does; `mixed-route-segment.parity.spec.ts`
 * pins it by running the real router.
 *
 * DIRECTORY CONTRACT — nothing here may import `node:fs`, `node:path`, `vite`
 * or `fastify`.
 */

/** One piece of a mixed segment: literal text, or a `:name` param. */
export type MixedSegmentPart =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "param"; readonly name: string };

export type MixedSegmentParse =
  | { readonly type: "mixed"; readonly parts: readonly MixedSegmentPart[] }
  | { readonly type: "invalid"; readonly reason: string };

/** The longest value one mixed-segment param captures, the same cap a whole-segment param has. */
const MIXED_PARAMETER_MAX_LENGTH = 100;

const PARAMETER_NAME_CHARACTER = /[A-Za-z0-9_]/;
const TEXT_CHARACTER = /[\p{L}\p{N}._~-]/u;
const NAMED_WILDCARD = /^\*([A-Za-z0-9_]+)$/;

/**
 * Splits a segment that contains `:` into text and param parts. Returns
 * `invalid` for an empty param name, two params with no text between them
 * (their split would be arbitrary), or a character outside letters, digits and
 * `. _ ~ -` in the text. A whole-segment param (`:id`) parses as one param
 * part; callers decide whether that shape is a plain param first.
 */
export function parseMixedSegment(segment: string): MixedSegmentParse {
  const parts: MixedSegmentPart[] = [];
  let index = 0;

  while (index < segment.length) {
    const character = segment[index] ?? "";

    if (character === ":") {
      let end = index + 1;
      while (end < segment.length && PARAMETER_NAME_CHARACTER.test(segment[end] ?? "")) end++;

      if (end === index + 1) {
        return { type: "invalid", reason: `a ":" must be followed by a param name` };
      }
      if (parts[parts.length - 1]?.type === "param") {
        return {
          type: "invalid",
          reason: `two params need static text between them (such as ":a-:b"), because the split would be arbitrary`,
        };
      }

      parts.push({ type: "param", name: segment.slice(index + 1, end) });
      index = end;
      continue;
    }

    let end = index;
    while (end < segment.length && segment[end] !== ":") {
      if (!TEXT_CHARACTER.test(segment[end] ?? "")) {
        return {
          type: "invalid",
          reason: `static text next to a param may use only letters, digits and ". _ ~ -", not "${segment[end]}"`,
        };
      }
      end++;
    }

    parts.push({ type: "text", value: segment.slice(index, end) });
    index = end;
  }

  return { type: "mixed", parts };
}

/** The wildcard name of a `*name` segment, or `undefined` when the segment is anything else. */
export function namedWildcardOfSegment(segment: string): string | undefined {
  return NAMED_WILDCARD.exec(segment)?.[1];
}

/** The name of a path's terminal `*name` wildcard, or `undefined` (a bare `*` has none). */
export function namedWildcardOfPath(path: string): string | undefined {
  const lastSlash = path.lastIndexOf("/");

  return namedWildcardOfSegment(path.slice(lastSlash + 1));
}

/**
 * The path the router registers: a terminal `*name` becomes the router's own
 * `*`, which it exposes as the `"*"` param. Every other path is returned as is.
 */
export function routerPathOf(path: string): string {
  const name = namedWildcardOfPath(path);

  return name === undefined ? path : path.slice(0, path.length - name.length);
}

/** Adds the `name` alias of a terminal `*name` wildcard to the router's params; other routes pass through. */
export function withNamedWildcardParam(
  path: string,
  params: Record<string, string>,
): Record<string, string> {
  const name = namedWildcardOfPath(path);
  const value = params?.["*"];

  if (name === undefined || value === undefined) return params;

  return { ...params, [name]: value };
}

function escapeText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The regular-expression source for a mixed segment: text is literal, each
 * param is one greedy capture group. {@link MixedSegmentPart} order is the
 * group order.
 */
export function mixedSegmentSource(parts: readonly MixedSegmentPart[]): string {
  return parts
    .map((part) =>
      part.type === "text" ? escapeText(part.value) : `([^/]{0,${MIXED_PARAMETER_MAX_LENGTH}})`,
    )
    .join("");
}

function textLength(parts: readonly MixedSegmentPart[], pick: "first" | "last" | "all"): number {
  if (pick === "all") {
    return parts.reduce((total, part) => total + (part.type === "text" ? part.value.length : 0), 0);
  }

  const part = parts[pick === "first" ? 0 : parts.length - 1];

  return part?.type === "text" ? part.value.length : 0;
}

/**
 * Orders two mixed segments that can sit at the same position: negative when
 * `left` is more specific. The longer leading text wins, then the longer
 * trailing text, then more static text overall. Two segments equal on all
 * three can match the same URLs, and the router's own choice between them
 * depends on registration order — avoid declaring such a pair.
 */
export function compareMixedSegments(
  left: readonly MixedSegmentPart[],
  right: readonly MixedSegmentPart[],
): number {
  return (
    textLength(right, "first") - textLength(left, "first") ||
    textLength(right, "last") - textLength(left, "last") ||
    textLength(right, "all") - textLength(left, "all")
  );
}

type SegmentShape =
  | { readonly type: "static"; readonly value: string }
  | { readonly type: "param" }
  | { readonly type: "wildcard" }
  | { readonly type: "mixed"; readonly parts: readonly MixedSegmentPart[] };

function shapeOfSegment(segment: string): SegmentShape {
  if (segment === "*" || namedWildcardOfSegment(segment) !== undefined) return { type: "wildcard" };
  if (!segment.includes(":")) return { type: "static", value: segment };

  const parsed = parseMixedSegment(segment);

  if (parsed.type !== "mixed") return { type: "static", value: segment };
  if (parsed.parts.every((part) => part.type === "param")) return { type: "param" };

  return { type: "mixed", parts: parsed.parts };
}

/** Whether a page route path has a segment that mixes params with static text. */
export function hasMixedSegment(path: string): boolean {
  return path.split("/").some((segment) => shapeOfSegment(segment).type === "mixed");
}

/**
 * Whether two page route paths could match the same URL AND the router's
 * choice between them would be a tie: same number of segments, every pair of
 * segments the same kind (or a static segment against itself), and at least one
 * pair of mixed segments that tie on leading, trailing and total static text.
 * The check is deliberately conservative — it may refuse a pair whose mixed
 * segments could never match one URL — because the server's router picks
 * between such a pair by registration order, which the browser cannot mirror.
 */
export function mixedRoutesTie(left: string, right: string): boolean {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");

  if (leftSegments.length !== rightSegments.length) return false;

  let tied = false;

  for (const [index, leftSegment] of leftSegments.entries()) {
    const leftShape = shapeOfSegment(leftSegment);
    const rightShape = shapeOfSegment(rightSegments[index] ?? "");

    if (leftShape.type !== rightShape.type) return false;
    if (leftShape.type === "static" && leftShape.value !== (rightShape as typeof leftShape).value) {
      return false;
    }
    if (leftShape.type === "mixed" && rightShape.type === "mixed") {
      if (compareMixedSegments(leftShape.parts, rightShape.parts) !== 0) return false;
      tied = true;
    }
  }

  return tied;
}
