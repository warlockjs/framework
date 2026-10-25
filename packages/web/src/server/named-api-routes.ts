import { router, type NamedApiRoute } from "@warlock.js/core";
import type {
  NamedApiRouteCandidate,
  NamedApiRouteContext,
  NamedApiRoutesConfig,
  NamedApiRoutesInclude,
  NamedApiRoutesOption,
} from "../named-api-routes-config";
import type { NamedApiRouteRegistry } from "./dev-client-api-route-names";
import type { NamedApiRouteMetadata } from "../routing/named-api-routes";

/** What decides the table besides the page's own names: the viewer, the site and `web.namedApiRoutes`. */
export type ResolveNamedApiRoutesOptions = {
  /** `web.namedApiRoutes`. Absent applies no rule beyond site scoping and guarded routes. */
  config?: NamedApiRoutesOption;
  /** Key of the site serving the document; absent in single-site mode. */
  site?: string;
  /**
   * Whether the viewer is KNOWN to be signed out. Defaults to `false`: without a
   * session resolver the viewer is unknown (the app may sign in with tokens in
   * the browser), so routes behind an auth guard stay in the table.
   */
  guest?: boolean;
  /**
   * The router registry to read. Absent reads this module's own `router`, which
   * is empty when the renderer is a separate copy of Core (the development SSR
   * graph); the side that owns the real router passes it.
   */
  registry?: NamedApiRouteRegistry;
};

/** An allowlist entry: an exact route name or a `prefix.*` pattern. */
function matchesPattern(name: string, pattern: string): boolean {
  return pattern.endsWith(".*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/**
 * Whether `path` is `prefix` itself or lives below it, compared by whole path
 * segments: `/api/admin` covers `/api/admin` and `/api/admin/users`, never
 * `/api/administrators`. A trailing slash on the prefix changes nothing.
 */
export function isUnderPrivatePrefix(path: string, prefix: string): boolean {
  const base = prefix.replace(/\/+$/, "");

  if (base === "") return true;

  return path === base || path.startsWith(`${base}/`);
}

function readConfig(config: NamedApiRoutesOption | undefined): {
  include: NamedApiRoutesInclude | undefined;
  privatePrefixes: readonly string[];
} {
  if (config == null || config === false) return { include: undefined, privatePrefixes: [] };

  if (Array.isArray(config) || typeof config === "function") {
    return { include: config as NamedApiRoutesInclude, privatePrefixes: [] };
  }

  const options = config as NamedApiRoutesConfig;

  return { include: options.include, privatePrefixes: options.privatePrefixes ?? [] };
}

function readRegistry(source?: NamedApiRouteRegistry): readonly NamedApiRoute[] | undefined {
  try {
    return (source ?? router).getNamedApiRoutes();
  } catch {
    return undefined;
  }
}

/**
 * The browser route table for ONE page document: the registered named API
 * routes whose names the page may embed (`names`), minus every route the
 * server keeps out of this viewer's hands:
 *
 * 1. `clientVisible: false` routes, for everyone;
 * 2. routes under `web.namedApiRoutes.privatePrefixes`, for everyone;
 * 3. routes declared for other sites (the `sites` route or group option), when
 *    a site serves the document; a route that declares no sites is shared;
 * 4. routes with an auth guard in their middleware chain, for a guest viewer;
 * 5. routes the `web.namedApiRoutes` allowlist or filter does not admit.
 *
 * There is deliberately no "all routes" answer. A document that is asked for
 * no names embeds an empty table, and an unregistered name is simply absent, so
 * a page never carries more of the API surface than its client code reaches.
 * `undefined` when `web.namedApiRoutes` is `false`, and when Core's registry
 * cannot be read; the browser reports either rather than papering over it.
 */
export function resolveNamedApiRoutes(
  names: readonly string[] = [],
  options: ResolveNamedApiRoutesOptions = {},
): NamedApiRouteMetadata | undefined {
  if (options.config === false) return undefined;

  const registry = readRegistry(options.registry);

  if (registry === undefined) return undefined;

  const { include, privatePrefixes } = readConfig(options.config);
  const context: NamedApiRouteContext = Object.freeze({
    site: options.site,
    guest: options.guest ?? false,
  });
  const wanted = new Set(names);
  const result: Record<string, { path: string; method: string }> = Object.create(null);

  for (const route of registry) {
    if (route.clientVisible === false || !wanted.has(route.name)) continue;
    if (privatePrefixes.some((prefix) => isUnderPrivatePrefix(route.path, prefix))) continue;
    if (context.site !== undefined && route.sites && !route.sites.includes(context.site)) continue;
    if (context.guest && route.guarded === true) continue;

    if (Array.isArray(include)) {
      if (!include.some((pattern) => matchesPattern(route.name, pattern))) continue;
    } else if (typeof include === "function") {
      const candidate: NamedApiRouteCandidate = Object.freeze({
        name: route.name,
        path: route.path,
        method: route.method,
        sites: route.sites,
        guarded: route.guarded === true,
      });

      // A throwing filter is the app's bug: let it surface rather than ship a wrong table.
      if (!include(candidate, context)) continue;
    }

    result[route.name] = Object.freeze({ path: route.path, method: route.method });
  }

  return Object.freeze(result);
}

const STABLE_ROUTE_NAMES = Symbol.for("warlock.web.stable-route-names");

/** A page's route-name function whose answer never changes while the process runs. */
export type RouteNamesFunction = (() => readonly string[]) & {
  readonly [STABLE_ROUTE_NAMES]?: true;
};

/**
 * Marks a page's route names as fixed for the life of the process, which is
 * what a production page's names are: the build baked them into the manifest.
 * {@link resolveCachedNamedApiRoutes} then computes the page's table once per
 * viewer kind (site and guest) instead of walking the registry per request.
 * Development never marks its names: the live registry and the files they come
 * from change under it.
 */
export function stableRouteNames(names: readonly string[]): RouteNamesFunction {
  return Object.assign(() => names, { [STABLE_ROUTE_NAMES]: true as const });
}

type CachedTables = {
  readonly config: unknown;
  readonly tables: Map<string, NamedApiRouteMetadata>;
};

const cachedTables = new WeakMap<object, CachedTables>();

/**
 * {@link resolveNamedApiRoutes} for one document. Names marked with
 * {@link stableRouteNames} are resolved once per site and viewer kind and the
 * frozen table is reused; any other names are resolved on every call. A
 * `web.namedApiRoutes` filter function is therefore called once per route, site
 * and viewer kind, not once per request, and a replaced configuration starts
 * the cache over. An unreadable registry is never cached.
 */
export function resolveCachedNamedApiRoutes(
  routeNames: RouteNamesFunction | undefined,
  options: ResolveNamedApiRoutesOptions,
): NamedApiRouteMetadata | undefined {
  if (routeNames === undefined || routeNames[STABLE_ROUTE_NAMES] !== true) {
    return resolveNamedApiRoutes(routeNames?.(), options);
  }

  let entry = cachedTables.get(routeNames);

  if (entry === undefined || entry.config !== options.config) {
    entry = { config: options.config, tables: new Map() };
    cachedTables.set(routeNames, entry);
  }

  const key = `${options.site ?? ""}\u0000${options.guest === true ? "guest" : "viewer"}`;
  const cached = entry.tables.get(key);

  if (cached !== undefined) return cached;

  const table = resolveNamedApiRoutes(routeNames(), options);

  if (table !== undefined) entry.tables.set(key, table);

  return table;
}
