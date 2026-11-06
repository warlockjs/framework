import { namedWildcardOfSegment, parseMixedSegment } from "./mixed-route-segment";

/** One route parameter whose name can be represented precisely in generated TypeScript. */
export type RoutePathParameter = {
  name: string;
  optional: boolean;
};

/**
 * The parser either recognizes the whole route parameter grammar or deliberately
 * returns `broad`, so generated declarations never promise a narrower shape
 * than the router can accept.
 */
export type RoutePathParameterParse =
  | { type: "precise"; parameters: readonly RoutePathParameter[] }
  | { type: "broad" };

/** Options for {@link parseRoutePathParameters}. */
export type RoutePathParameterParseOptions = {
  /**
   * Also recognize page-route shapes: segments that mix params with static
   * text (`:type-for-:purpose`) and a named terminal wildcard (`*rest`). Off
   * by default, so API route typings stay as broad as they have always been.
   */
  readonly mixedSegments?: boolean;
};

const PARAMETER_SEGMENT = /^:([A-Za-z0-9_]+)(\?)?$/;

/**
 * Parse whole-segment `:name`, optional `:name?`, and terminal/bare `*`
 * parameters. Regex params, suffix params, repeated conflicting names, and any
 * later router syntax return `broad` rather than a misleading generated type.
 */
export function parseRoutePathParameters(
  path: string,
  options: RoutePathParameterParseOptions = {},
): RoutePathParameterParse {
  const parameters = new Map<string, boolean>();

  const segments = path.split("/");

  for (const [index, segment] of segments.entries()) {
    if (segment === "") continue;
    if (segment === "*") {
      if (index !== segments.length - 1 || parameters.has("*")) return { type: "broad" };
      parameters.set("*", false);
      continue;
    }

    const match = segment.match(PARAMETER_SEGMENT);
    if (match) {
      const name = match[1];
      const optional = match[2] === "?";
      if (name === undefined) return { type: "broad" };
      const existing = parameters.get(name);
      if (existing !== undefined && existing !== optional) return { type: "broad" };
      parameters.set(name, optional);
      continue;
    }

    if (options.mixedSegments === true) {
      const wildcard = namedWildcardOfSegment(segment);

      if (wildcard !== undefined) {
        if (index !== segments.length - 1 || parameters.has(wildcard)) return { type: "broad" };
        parameters.set(wildcard, false);
        continue;
      }

      const mixed = segment.includes(":") ? parseMixedSegment(segment) : undefined;

      if (mixed?.type === "mixed") {
        for (const part of mixed.parts) {
          if (part.type !== "param") continue;
          if (parameters.has(part.name)) return { type: "broad" };
          parameters.set(part.name, false);
        }
        continue;
      }
    }

    if (segment.includes(":") || segment.includes("*")) return { type: "broad" };
  }

  return {
    type: "precise",
    parameters: [...parameters].map(([name, optional]) => ({ name, optional })),
  };
}
