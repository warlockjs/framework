import type { RequestMethod } from "../router/types";

/**
 * The concrete verbs an `all` route expands into. Mirrors `ALL_METHODS` in the route registry.
 */
const ALL_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

export type OpenApiMethod = (typeof ALL_METHODS)[number];

const PATH_PARAM_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)(\([^)]*\))?/g;

/**
 * Convert a Warlock path into an OpenAPI path template: `/users/:id` -> `/users/{id}`.
 * A Fastify-style regex suffix (`:id(\d+)`) is dropped.
 */
export function toOpenApiPath(path: string): string {
  return path.replace(PATH_PARAM_PATTERN, (_match, name: string) => `{${name}}`);
}

/**
 * Names of the path parameters of a Warlock path, in order of appearance.
 */
export function extractPathParamNames(path: string): string[] {
  return [...path.matchAll(PATH_PARAM_PATTERN)].flatMap((match) => match[1] ?? []);
}

/**
 * Lowercase operation verbs of a route method; `all` expands to every verb.
 */
export function expandMethods(method: RequestMethod | string): OpenApiMethod[] {
  const lowered = String(method).toLowerCase();

  if (lowered === "all") {
    return [...ALL_METHODS];
  }

  return (ALL_METHODS as readonly string[]).includes(lowered) ? [lowered as OpenApiMethod] : [];
}

/**
 * `operationId` for an operation. A named route keeps its name (with `.<verb>` appended when
 * an `all` route expands into several operations); an unnamed route gets a `method_path_slug`
 * id such as `get_users_id`.
 */
export function buildOperationId(
  name: string | undefined,
  method: OpenApiMethod,
  path: string,
  expanded: boolean,
): string {
  if (name) {
    return expanded ? `${name}.${method}` : name;
  }

  const slug = path
    .replace(PATH_PARAM_PATTERN, "$1")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug ? `${method}_${slug}` : method;
}

/**
 * Tag of a route: its first static path segment (`/users/:id` -> `users`).
 */
export function firstSegmentTag(path: string): string | undefined {
  const segment = path.split("/").find((part) => part.length > 0);

  if (!segment || segment.startsWith(":") || segment === "*") {
    return undefined;
  }

  return segment;
}

/**
 * Verbs whose requests carry no body, so unscoped validation maps to query parameters.
 */
export function isBodylessMethod(method: OpenApiMethod): boolean {
  return method === "get" || method === "head" || method === "delete" || method === "options";
}
