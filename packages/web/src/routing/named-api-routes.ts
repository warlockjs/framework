/** Browser-safe metadata for named API routes. No handlers or route options cross this boundary. */
export type NamedApiRouteMetadata = Readonly<
  Record<string, Readonly<{ path: string; method: string }>>
>;

/**
 * The published table lives on `globalThis`, not in module state: on the server
 * the renderer that knows the page's table and the page code that calls
 * `apiHref()` can be separate copies of this module (the dev SSR graph inlines
 * the framework when the application aliases it).
 */
const PUBLISHED_KEY = Symbol.for("warlock.web.published-named-api-routes");

type PublishedSlot = { routes?: NamedApiRouteMetadata };

function slot(): PublishedSlot {
  const host = globalThis as unknown as Record<symbol, PublishedSlot | undefined>;

  return (host[PUBLISHED_KEY] ??= {});
}

export function publishNamedApiRoutes(routes: NamedApiRouteMetadata | undefined): void {
  slot().routes = routes;
}

export function readNamedApiRoutes(): NamedApiRouteMetadata | undefined {
  return slot().routes;
}

/**
 * The error for a name this page's table does not carry. Every page embeds only
 * the routes its own client code reaches, so a missing name means the code
 * reached a name the build could not see, or one the server does not offer to
 * browsers. Development names the fix in full; production stays short.
 */
function missingRouteMessage(name: string): string {
  const quoted = JSON.stringify(name);
  const published = readNamedApiRoutes();
  if (published === undefined) {
    return import.meta.env?.DEV
      ? `Named API route ${quoted} cannot be resolved: this document embeds no route table. Either ` +
          "web.namedApiRoutes is false in the application's web configuration (named routes are " +
          "switched off), or Core's route registry could not be read. Use an explicit path and " +
          "method, or remove web.namedApiRoutes: false."
      : `Named API route ${quoted} is not available: this document embeds no route table. Use an explicit path and method.`;
  }
  if (import.meta.env?.DEV) {
    return (
      `Named API route ${quoted} is not in this page's browser route table. Each page embeds only the ` +
      "named routes its client code can reach. Fix: name the route with a string literal in code the " +
      `page imports, or declare it with config.apiRoutes in the page's setup file (${quoted} or a ` +
      '"prefix.*" pattern). A route marked clientVisible: false, a route under web.namedApiRoutes.privatePrefixes, a ' +
      "route declared for another site, and (for a signed-out viewer) a route behind an auth guard are " +
      "never in the table; call such an endpoint from the server or with an explicit path. An explicit path and method always work."
    );
  }
  return (
    `Named API route ${quoted} is not in this page's route table. Use an explicit path and method, ` +
    "or declare the name with config.apiRoutes in the page's setup file."
  );
}

/** Resolves one named API route for browser consumers. `all` has no safe request verb. */
export function resolveApiRoute(name: string): Readonly<{ path: string; method: string }> {
  const published = readNamedApiRoutes();
  const route = published && Object.hasOwn(published, name) ? published[name] : undefined;
  if (route === undefined) throw new Error(missingRouteMessage(name));
  if (route.method === "all") {
    throw new Error(
      `Named API route ${JSON.stringify(name)} accepts method "all" and cannot choose a browser request verb. Use an explicit path and method.`,
    );
  }
  return route;
}

export function parseNamedApiRoutes(value: unknown): NamedApiRouteMetadata | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, { path: string; method: string }> = Object.create(null);
  for (const [name, route] of Object.entries(value)) {
    if (!route || typeof route !== "object" || Array.isArray(route)) return undefined;
    const { path, method } = route as Record<string, unknown>;
    if (typeof path !== "string" || typeof method !== "string") return undefined;
    result[name] = Object.freeze({ path, method });
  }
  return Object.freeze(result);
}

/**
 * The names a page document may embed: every route the snapshot carries except
 * those that opted out of the browser (`clientVisible: false`, Core's route
 * option). Build-time only: the browser never sees the snapshot itself.
 */
export function clientVisibleRouteNames(
  routes: readonly { readonly name: string; readonly clientVisible?: false }[],
): string[] {
  return routes.filter((route) => route.clientVisible !== false).map((route) => route.name);
}
