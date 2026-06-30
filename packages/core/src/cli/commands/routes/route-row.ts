import type { Route } from "../../../router/types";

/**
 * A single registered route, normalized to the flat, display-ready shape the
 * `warlock routes` table (and its `--json` output) render. Kept separate from
 * the live {@link Route} so the formatter and filters never touch the handler
 * function, validation object, or Fastify server options — only printable
 * scalars.
 */
export type RouteRow = {
  /** Uppercased HTTP verb (`"all"` → `"ALL"`). */
  method: string;

  /** Full request path (prefix already folded in by the router). */
  path: string;

  /** Route name, or `""` when the route was registered without one. */
  name: string;

  /** Handler/controller-action label — the handler function name, or `"anonymous"`. */
  action: string;

  /** Number of middleware attached to the route. */
  middleware: number;

  /** Relative source file the route was registered from, or `""`. */
  source: string;
};

/** Filters accepted by `warlock routes`, each optional and additive (AND-ed). */
export type RouteFilter = {
  /** Exact HTTP method (case-insensitive). */
  method?: string;

  /** Case-insensitive substring matched against the path. */
  path?: string;

  /** Case-insensitive substring matched against the route name. */
  name?: string;
};

/**
 * Display order of HTTP methods — used to rank rows within a path and to order
 * the per-method breakdown in the summary line.
 */
export const METHOD_ORDER = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "ALL",
];

/**
 * Rank of a method for sorting. Unknown methods sort last (stable among
 * themselves).
 *
 * @param method - Uppercased HTTP verb
 * @returns The sort index
 */
export function methodRank(method: string): number {
  const index = METHOD_ORDER.indexOf(method);
  return index === -1 ? METHOD_ORDER.length : index;
}

/**
 * Derive the handler/controller-action label for a route. Uses the handler
 * function's name, stripping the `bound ` prefix that `Function.prototype.bind`
 * prepends, and falls back to `"anonymous"` for an unnamed handler.
 *
 * @param route - The route to label
 * @returns A printable action label
 */
function routeAction(route: Route): string {
  const handler = route.handler as unknown;

  if (typeof handler !== "function") return "anonymous";

  const name = handler.name?.replace(/^bound /, "").trim();

  return name ? name : "anonymous";
}

/**
 * Normalize a live {@link Route} into a printable {@link RouteRow}.
 *
 * @param route - The registered route
 * @returns The display-ready row
 */
export function toRouteRow(route: Route): RouteRow {
  return {
    method: route.method.toUpperCase(),
    path: route.path,
    name: route.name ?? "",
    action: routeAction(route),
    middleware: route.middleware?.length ?? 0,
    source: route.sourceFile ?? "",
  };
}

/**
 * Apply the `--method` / `--path` / `--name` filters to a set of rows. An
 * omitted filter matches everything; provided filters are AND-ed.
 *
 * @param rows - The rows to filter
 * @param filter - The active filters
 * @returns The matching rows (a new array)
 */
export function filterRouteRows(rows: RouteRow[], filter: RouteFilter): RouteRow[] {
  const method = filter.method?.toUpperCase();
  const path = filter.path?.toLowerCase();
  const name = filter.name?.toLowerCase();

  return rows.filter((row) => {
    if (method && row.method !== method) return false;
    if (path && !row.path.toLowerCase().includes(path)) return false;
    if (name && !row.name.toLowerCase().includes(name)) return false;
    return true;
  });
}

/**
 * Sort rows by path (ascending), then by HTTP-method order within a path, so
 * every verb of one resource lists together in a predictable sequence.
 *
 * @param rows - The rows to sort
 * @returns A new, sorted array
 */
export function sortRouteRows(rows: RouteRow[]): RouteRow[] {
  return [...rows].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return methodRank(a.method) - methodRank(b.method);
  });
}
