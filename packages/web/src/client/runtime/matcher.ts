import {
  compareMixedSegments,
  hasMixedSegment,
  mixedRoutesTie,
  mixedSegmentSource,
  namedWildcardOfSegment,
  parseMixedSegment,
  type MixedSegmentPart,
} from "../../routing/mixed-route-segment";
import { isPrefixedLocale, readLocaleRouting } from "../../routing/locale-routing";
import type { ClientPageEntry, ClientRouteMatch } from "./types";

type RouteToken =
  | { readonly type: "static"; readonly value: string }
  | { readonly type: "parameter"; readonly name: string }
  | { readonly type: "mixed"; readonly parts: readonly MixedSegmentPart[] }
  | { readonly type: "catch-all"; readonly name: string };

type CompiledRoute = {
  readonly entry: ClientPageEntry;
  readonly tokens: readonly RouteToken[];
  readonly parameterNames: readonly string[];
  readonly expression: RegExp;
  readonly collisionKey: string;
  /** The terminal wildcard's own name, when it has one besides `"*"`; its value is also kept under `"*"`. */
  readonly wildcardAlias: string | undefined;
};

type SanitizedPath = {
  readonly path: string;
  readonly shouldDecodeParameters: boolean;
};

const PARAMETER_NAME = /^[A-Za-z0-9_]+$/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL, "\\$&");
}

function decodeReservedCharacter(high: string, low: string): string | null {
  const pair = `${high}${low}`.toUpperCase();
  const reserved: Readonly<Record<string, string>> = {
    "23": "#",
    "24": "$",
    "25": "%",
    "26": "&",
    "2B": "+",
    "2C": ",",
    "2F": "/",
    "3A": ":",
    "3B": ";",
    "3D": "=",
    "3F": "?",
    "40": "@",
  };

  return reserved[pair] ?? null;
}

function sanitizePathname(pathname: string): SanitizedPath | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    throw new Error("Client route pathname must start with '/'");
  }

  let path = pathname;
  let shouldDecode = false;
  let shouldDecodeParameters = false;

  for (let index = 1; index < path.length; index++) {
    if (path[index] !== "%") continue;

    const high = path[index + 1] ?? "";
    const low = path[index + 2] ?? "";
    const reserved = decodeReservedCharacter(high, low);

    if (reserved === null) {
      shouldDecode = true;
      continue;
    }

    shouldDecodeParameters = true;
    if (reserved === "%") {
      path = `${path.slice(0, index + 1)}25${path.slice(index + 1)}`;
      shouldDecode = true;
      index += 2;
    }
    index += 2;
  }

  try {
    if (shouldDecode) path = decodeURI(path);
  } catch {
    return null;
  }

  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return { path, shouldDecodeParameters };
}

function decodeParameter(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "%") {
      decoded += value[index];
      continue;
    }

    const reserved = decodeReservedCharacter(value[index + 1] ?? "", value[index + 2] ?? "");
    if (reserved === null) return value;

    decoded += reserved;
    index += 2;
  }

  return decoded;
}

/** Whether a segment holding `:` could be a mixed segment rather than a malformed param. */
function isMixedCandidate(segment: string): boolean {
  return !segment.includes("*") && !segment.includes("%") && parseMixedSegment(segment).type === "mixed";
}

function parsePattern(entry: ClientPageEntry): CompiledRoute {
  const original = entry.path;
  const isExactRootCatchAll = original === "*";
  if (!isExactRootCatchAll && !original.startsWith("/")) {
    throw new Error(`Client route pattern '${original}' must start with '/'`);
  }

  const pattern = original.length > 1 && original.endsWith("/") ? original.slice(0, -1) : original;
  const segments = isExactRootCatchAll ? ["*"] : pattern === "/" ? [] : pattern.slice(1).split("/");
  const tokens: RouteToken[] = [];
  const parameterNames: string[] = [];

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!segment) {
      throw new Error(`Client route pattern '${original}' contains an empty segment`);
    }

    const wildcardName = segment === "*" ? "*" : namedWildcardOfSegment(segment);

    if (wildcardName !== undefined) {
      if (index !== segments.length - 1) {
        throw new Error(`Client route pattern '${original}' has a non-terminal catch-all`);
      }
      if (parameterNames.includes(wildcardName)) {
        throw new Error(`Client route pattern '${original}' repeats parameter '${wildcardName}'`);
      }
      tokens.push({ type: "catch-all", name: wildcardName });
      parameterNames.push(wildcardName);
      continue;
    }

    if (segment.startsWith(":") && (PARAMETER_NAME.test(segment.slice(1)) || !isMixedCandidate(segment))) {
      const name = segment.slice(1);
      if (!PARAMETER_NAME.test(name)) {
        throw new Error(`Client route pattern '${original}' has an unsupported parameter segment`);
      }
      if (parameterNames.includes(name)) {
        throw new Error(`Client route pattern '${original}' repeats parameter '${name}'`);
      }
      tokens.push({ type: "parameter", name });
      parameterNames.push(name);
      continue;
    }

    if (segment.includes(":") && !segment.includes("*") && !segment.includes("%")) {
      const parsed = parseMixedSegment(segment);

      if (parsed.type === "mixed") {
        for (const part of parsed.parts) {
          if (part.type !== "param") continue;
          if (parameterNames.includes(part.name)) {
            throw new Error(`Client route pattern '${original}' repeats parameter '${part.name}'`);
          }
          parameterNames.push(part.name);
        }
        tokens.push({ type: "mixed", parts: parsed.parts });
        continue;
      }
    }

    if (
      segment.includes(":") ||
      segment.includes("*") ||
      segment.includes("?") ||
      segment.includes("%")
    ) {
      throw new Error(`Client route pattern '${original}' contains unsupported syntax`);
    }
    tokens.push({ type: "static", value: segment });
  }

  let source = "^";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "static") source += `/${escapeRegExp(token.value)}`;
    if (token.type === "parameter") source += "/([^/]{1,100})";
    if (token.type === "mixed") source += `/${mixedSegmentSource(token.parts)}`;
    if (token.type === "catch-all") {
      source += isExactRootCatchAll ? "(.*)" : index === 0 ? "/(.*)" : "/(.+)";
    }
  }
  if (tokens.length === 0) source += "/";
  source += "$";

  const collisionKey = tokens
    .map((token) => {
      if (token.type === "static") return `s:${token.value}`;
      if (token.type === "parameter") return "p";
      if (token.type === "mixed") {
        return `m:${token.parts.map((part) => (part.type === "text" ? part.value : "p")).join("")}`;
      }
      return "w";
    })
    .join("/");

  return {
    entry,
    tokens,
    parameterNames,
    expression: new RegExp(source),
    collisionKey,
    wildcardAlias: tokens.some((token) => token.type === "catch-all" && token.name !== "*")
      ? "*"
      : undefined,
  };
}

function compareSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  // Static text beats a mixed segment, which beats a whole-segment param,
  // which beats the catch-all — the order the server's router applies.
  const rank = (token: RouteToken | undefined): number => {
    if (!token || token.type === "static") return 4;
    if (token.type === "mixed") return 3;
    if (token.type === "parameter") return 2;
    return 1;
  };

  const length = Math.max(left.tokens.length, right.tokens.length);
  for (let index = 0; index < length; index++) {
    const leftToken = left.tokens[index];
    const rightToken = right.tokens[index];
    const difference = rank(rightToken) - rank(leftToken);
    if (difference !== 0) return difference;
    if (leftToken?.type === "mixed" && rightToken?.type === "mixed") {
      const mixedDifference = compareMixedSegments(leftToken.parts, rightToken.parts);
      if (mixedDifference !== 0) return mixedDifference;
    }
  }
  return 0;
}

function compileRoutes(entries: readonly ClientPageEntry[]): readonly CompiledRoute[] {
  const collisions = new Map<string, ClientPageEntry>();
  const routes = entries.map((entry) => {
    const route = parsePattern(entry);
    const existing = collisions.get(route.collisionKey);
    if (existing) {
      throw new Error(
        `Client route patterns '${existing.path}' and '${entry.path}' collide under server matching`,
      );
    }
    collisions.set(route.collisionKey, entry);
    if (hasMixedSegment(entry.path)) {
      const tied = entries.find(
        (other) => other !== entry && hasMixedSegment(other.path) && mixedRoutesTie(other.path, entry.path),
      );
      if (tied) {
        throw new Error(
          `Client route patterns '${tied.path}' and '${entry.path}' collide under server matching`,
        );
      }
    }
    return route;
  });

  return routes.sort(compareSpecificity);
}

/**
 * The sanitized path, with a routed locale prefix removed, and which locale
 * that was — design note §B.1: "if the first segment is a routed code,
 * strip it and match the rest, and the navigation's locale is that code."
 *
 * Under `"prefix-except-default"`, the default locale is never itself a
 * prefix (`isPrefixedLocale` says so), so a BARE path still reports the
 * default as its locale — design note §B.1's own example, `/en/posts` is not
 * stripped and `/posts` means `en`. Under `"none"` this never strips
 * anything and never reports a locale, which is what keeps every existing
 * caller of {@link matchClientRoute} — none of which expects a `locale` on
 * its result — unaffected.
 */
function stripLocalePrefix(path: string): { path: string; locale: string | undefined } {
  const routing = readLocaleRouting();

  if (routing.strategy === "none") return { path, locale: undefined };

  const slashIndex = path.indexOf("/", 1);
  const firstSegment = slashIndex === -1 ? path.slice(1) : path.slice(1, slashIndex);

  if (firstSegment !== "" && isPrefixedLocale(routing, firstSegment)) {
    const rest = slashIndex === -1 ? "/" : path.slice(slashIndex);

    return { path: rest, locale: firstSegment };
  }

  if (routing.strategy === "prefix-except-default") {
    return { path, locale: routing.defaultLocale };
  }

  return { path, locale: undefined };
}

/**
 * @deprecated Do not adopt for new code. This client-side matcher duplicates the
 * route grammar the server already evaluates, and divergence between the two is
 * silent (wrong page, not an error). It is superseded by navigation consuming the
 * server-returned page composition/page swap: the client requests loader data and
 * the matched page's identity rides back on that same response.
 *
 * Delete only after the server-answered page swap is proven working in production
 * use — not before. Deleting earlier leaves neither implementation in place.
 * Removing this export (and the `@warlock.js/web/client/runtime` re-export) is a
 * breaking change to a published subpath and must be announced as one.
 */
export function matchClientRoute(
  entries: readonly ClientPageEntry[],
  pathname: string,
): ClientRouteMatch | null {
  const routes = compileRoutes(entries);
  const sanitized = sanitizePathname(pathname);
  if (!sanitized) return null;

  const { path, locale } = stripLocalePrefix(sanitized.path);

  for (const route of routes) {
    const match = route.expression.exec(path);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let index = 0; index < route.parameterNames.length; index++) {
      const value = match[index + 1];
      params[route.parameterNames[index]] = sanitized.shouldDecodeParameters
        ? decodeParameter(value)
        : value;
    }
    if (route.wildcardAlias !== undefined) {
      const wildcardName = route.parameterNames[route.parameterNames.length - 1];
      if (wildcardName !== undefined) params[route.wildcardAlias] = params[wildcardName] ?? "";
    }
    return locale === undefined
      ? { entry: route.entry, params }
      : { entry: route.entry, params, locale };
  }

  return null;
}
