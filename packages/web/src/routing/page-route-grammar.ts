/**
 * Page-route grammar — the single, pure predicate that decides whether a
 * page's DECLARED, colon-form `route.path` (`/users/:id`) is inside the PAGE
 * route grammar. Page routes deliberately support a NARROWER grammar than
 * API routes. A page's FILESYSTEM segment grammar — the shape of a directory
 * name or basename on disk, such as `[id]` — is a separate concern owned by
 * the sibling module `page-file-segment.ts`; this predicate does not cover it.
 *
 * DIRECTORY CONTRACT — applies to everything in `web/src/routing/`: nothing
 * here may import `node:fs`, `node:path`, `vite`, or `fastify`. This module
 * receives a canonical route path string and trusts nothing about it beyond
 * what it checks — it asserts rather than trusts, but it never repairs a
 * malformed path into a valid one.
 *
 * ALLOWED — and ONLY these shapes; anything else is rejected by default:
 * the root path `/`; static segments (`/users/settings`); whole-segment
 * `:param` segments where the param occupies its entire segment
 * (`/users/:id`); mixed segments that hold several params and/or static
 * text (`/:type-for-:purpose`, `/near/:lat-:lng`, `/file/:name.png`, with
 * static text limited to letters, digits and `. _ ~ -`, and two params always
 * separated by text); the exact root wildcard `*` (the one path allowed
 * without a leading slash — distinct from `/*`); and slash-led paths whose
 * FINAL segment is `*` or a named wildcard `*name` (`/*`, `/prefix/*`,
 * `/a/b/*rest`). A param name may appear only once in a path that uses a
 * mixed segment or a named wildcard.
 *
 * REJECTED — each with a reason naming the offending construct and, where
 * one exists, the supported alternative: regex-constrained params
 * (`/users/:id(\d+)`), optional params (`/users/:id?`), two params with no
 * text between them (`/:a:b`), backslash-escaped colons
 * (`/path/\:literal`), a `*` that does not occupy a whole terminal segment
 * (`/a/prefix*`, or a wildcard before the final segment), paths missing
 * their leading slash, empty
 * segments from doubled slashes (`/a//b`), and trailing slashes (`/users/`).
 *
 * REJECTION IS DATA, NOT A THROW: {@link classifyPageRoutePath} is total and
 * never raises. What a rejection MEANS to the user is nonetheless fixed
 * here: {@link PageRoutePathNotSupportedError} is the single error contract
 * every caller raises when it refuses a rejected path — one class, one
 * message shape, built from the rejection reason plus caller-supplied page
 * identity. Callers decide only WHEN to raise it and supply that context;
 * none of them wraps the rejection in a category or wording of its own.
 */

import { namedWildcardOfSegment, parseMixedSegment } from "./mixed-route-segment";

/**
 * The predicate's verdict for one declared page route path:
 *
 * - `"allowed"` — the path is one of the grammar's allowed shapes.
 * - `"rejected"` — the path is outside the grammar; `reason` is a complete,
 *   user-readable sentence naming the offending construct (the segment, when
 *   one segment is at fault) and the supported alternative if one exists.
 */
export type PageRoutePathVerdict = { type: "allowed" } | { type: "rejected"; reason: string };

const allowed: PageRoutePathVerdict = { type: "allowed" };

function rejected(reason: string): PageRoutePathVerdict {
  return { type: "rejected", reason };
}

/** Whole-segment `:param` — the entire segment is `:` followed by a plain name. */
const wholeSegmentParamPattern = /^:[A-Za-z0-9_]+$/;

/**
 * Classifies one segment of a slash-led path. `isFinal` matters because `*`
 * is allowed only as the whole final segment, and an empty segment at the
 * end means a trailing slash rather than a doubled one.
 */
function classifySegment(segment: string, path: string, isFinal: boolean): PageRoutePathVerdict {
  if (segment === "") {
    if (isFinal) {
      return rejected(
        `Path "${path}" ends with a trailing slash, which page routes do not support — ` +
          `declare "${path.slice(0, -1)}" without the trailing slash instead.`,
      );
    }

    return rejected(
      `Path "${path}" contains an empty segment from a doubled slash, which page routes do not ` +
        `support — remove the extra slash.`,
    );
  }

  if (segment === "*" || (isFinal && namedWildcardOfSegment(segment) !== undefined)) {
    if (isFinal) {
      return allowed;
    }

    return rejected(
      `Path "${path}" uses "*" before its final segment, and page routes support "*" only as a ` +
        `terminal catch-all — move the "*" to the end of the path, as in "/a/b/*".`,
    );
  }

  if (segment.includes("*")) {
    if (isFinal) {
      return rejected(
        `Segment "${segment}" of "${path}" attaches "*" to other text, and page routes support ` +
          `"*" only as a whole final segment — declare it as its own segment, as in "/prefix/*".`,
      );
    }

    return rejected(
      `Segment "${segment}" of "${path}" uses "*" before the final segment, and page routes ` +
        `support "*" only as a whole terminal segment — move the "*" to the end of the path, as ` +
        `in "/a/b/*".`,
    );
  }

  if (segment.includes("\\:")) {
    return rejected(
      `Segment "${segment}" of "${path}" escapes a colon with a backslash, which page routes do ` +
        `not support — page routes treat ":" only as a param marker, so a literal ` +
        `colon cannot be declared; rename the segment to avoid the colon.`,
    );
  }

  if (!segment.includes(":")) {
    return allowed;
  }

  if (wholeSegmentParamPattern.test(segment)) {
    return allowed;
  }

  if (segment.includes("(")) {
    return rejected(
      `Segment "${segment}" of "${path}" constrains its param with a regex, which page routes do ` +
        `not support — use a plain whole-segment param such as ":id" and validate the value in ` +
        `the page instead.`,
    );
  }

  if (segment.endsWith("?")) {
    return rejected(
      `Segment "${segment}" of "${path}" marks its param optional with "?", which page routes do ` +
        `not support — declare two pages instead, one with the param segment and one without it.`,
    );
  }

  const parsed = parseMixedSegment(segment);

  if (parsed.type === "invalid") {
    return rejected(
      `Segment "${segment}" of "${path}" is not a supported mixed segment: ${parsed.reason}.`,
    );
  }

  return allowed;
}

/** The param names a segment declares, for the duplicate check; whole-segment params are not counted. */
function mixedParameterNames(segment: string): string[] {
  const wildcard = namedWildcardOfSegment(segment);

  if (wildcard !== undefined) return [wildcard];
  if (!segment.includes(":") || wholeSegmentParamPattern.test(segment)) return [];

  const parsed = parseMixedSegment(segment);

  return parsed.type === "mixed"
    ? parsed.parts.flatMap((part) => (part.type === "param" ? [part.name] : []))
    : [];
}

/**
 * Decides whether a declared page `route.path` is inside the page-route
 * grammar. Pure and total: every input yields a verdict and nothing throws.
 * `path` must already be canonical (no normalization is performed here — as
 * with the rest of this directory, this module asserts, it never repairs).
 */
export function classifyPageRoutePath(path: string): PageRoutePathVerdict {
  if (path === "*") {
    return allowed;
  }

  if (path === "") {
    return rejected(`The page route path is empty — declare "/" for the site root instead.`);
  }

  if (!path.startsWith("/")) {
    return rejected(
      `Path "${path}" does not start with "/", and the only page route allowed without a leading ` +
        `slash is the exact root wildcard "*" — declare "/${path}" instead.`,
    );
  }

  if (path === "/") {
    return allowed;
  }

  const segments = path.slice(1).split("/");
  const lastIndex = segments.length - 1;

  for (const [index, segment] of segments.entries()) {
    const verdict = classifySegment(segment, path, index === lastIndex);

    if (verdict.type === "rejected") {
      return verdict;
    }
  }

  // Whole-segment params keep their long-standing behavior; only the newer
  // shapes are checked for a name used twice, since a repeat would leave one
  // of the values unreachable.
  const names = new Set<string>();
  const wholeNames = segments.flatMap((segment) =>
    wholeSegmentParamPattern.test(segment) ? [segment.slice(1)] : [],
  );

  for (const segment of segments) {
    for (const name of mixedParameterNames(segment)) {
      if (names.has(name) || wholeNames.includes(name)) {
        return rejected(
          `Path "${path}" uses the param name "${name}" more than once — give each param its own name.`,
        );
      }
      names.add(name);
    }
  }

  return allowed;
}

/**
 * The single error contract for a rejected page route path — the one class
 * and one message every caller of {@link classifyPageRoutePath} raises when
 * it refuses a page whose declared path was rejected. `pageFile` is the
 * caller's context (its audience-appropriate identifier for the page — an
 * app-root-relative POSIX path, in practice); `routePath` and `reason` come
 * from the verdict; the category and wording are this module's.
 */
export class PageRoutePathNotSupportedError extends Error {
  public constructor(
    public readonly pageFile: string,
    public readonly routePath: string,
    public readonly reason: string,
  ) {
    super(
      `"${pageFile}" declares the page route path "${routePath}", which is not supported: ` +
        `${reason} Page routes support a narrower grammar than API routes — a page path may be ` +
        `"/", static segments, ":param" segments (optionally mixed with static text or other ` +
        `params, such as ":type-for-:purpose"), the exact root wildcard "*", or a path whose ` +
        `final segment is "*" or a named wildcard "*name" (such as "/prefix/*" or "/prefix/*rest").`,
    );
    this.name = "PageRoutePathNotSupportedError";
  }
}
