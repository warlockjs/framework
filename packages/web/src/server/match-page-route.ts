import {
  mixedSegmentSource,
  namedWildcardOfSegment,
  parseMixedSegment,
  type MixedSegmentPart,
} from "../routing/mixed-route-segment";
import type { PageRouteEntry } from "./execute-page-request.types";

/**
 * Stage 1 — turn a URL into a route entry plus its params.
 *
 * This matches only URL-driven render requests that have no HTTP router result
 * to carry through. On the live HTTP path core has already selected the route
 * and decoded its params; `create-page-route-handler.ts` passes that match into
 * the pipeline rather than re-running this matcher.
 *
 * `match-page-route.parity.spec.ts` keeps the param contract gated, including
 * a multi-segment URL and the param-free page catch-all convention.
 */

function splitSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Matches one URL segment against a mixed segment (`:type-for-:purpose`),
 * splitting it the way the router does: greedily, so every param but the last
 * takes as much as the following static text allows. Returns the decoded
 * values by param name.
 */
function matchMixedSegment(
  parts: readonly MixedSegmentPart[],
  pathSegment: string,
): Record<string, string> | undefined {
  const match = new RegExp(`^${mixedSegmentSource(parts)}$`).exec(pathSegment);

  if (match === null) return undefined;

  const values: Record<string, string> = {};
  let group = 1;

  for (const part of parts) {
    if (part.type === "param") values[part.name] = decodeURIComponent(match[group++] ?? "");
  }

  return values;
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternSegments = splitSegments(pattern);
  const pathSegments = splitSegments(pathname);
  const wildcardName = namedWildcardOfSegment(patternSegments[patternSegments.length - 1] ?? "");

  // A named terminal wildcard takes one segment or more, like the router's own.
  if (wildcardName === undefined) {
    if (patternSegments.length !== pathSegments.length) return undefined;
  } else if (pathSegments.length < patternSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  const fixedCount = wildcardName === undefined ? patternSegments.length : patternSegments.length - 1;

  if (wildcardName !== undefined) {
    const rest = pathSegments.slice(fixedCount).map(decodeURIComponent).join("/");

    params[wildcardName] = rest;
    params["*"] = rest;
  }

  for (let index = 0; index < fixedCount; index++) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];
    if (patternSegment === undefined || pathSegment === undefined) return undefined;

    if (patternSegment.startsWith(":")) {
      const mixed = parseMixedSegment(patternSegment);

      if (mixed.type === "mixed" && mixed.parts.some((part) => part.type === "text")) {
        const values = matchMixedSegment(mixed.parts, pathSegment);
        if (values === undefined) return undefined;
        Object.assign(params, values);
        continue;
      }

      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }

    if (patternSegment.includes(":")) {
      const mixed = parseMixedSegment(patternSegment);
      const values = mixed.type === "mixed" ? matchMixedSegment(mixed.parts, pathSegment) : undefined;
      if (values === undefined) return undefined;
      Object.assign(params, values);
      continue;
    }

    if (patternSegment !== pathSegment) return undefined;
  }

  return params;
}

export function matchRoute(
  pathname: string,
  routes: readonly PageRouteEntry[],
): { entry: PageRouteEntry; params: Record<string, string> } | undefined {
  for (const entry of routes) {
    const params = matchPath(entry.path, pathname);

    if (params) return { entry, params };
  }

  return undefined;
}
