/** Who is asking for a page's browser route table. */
export type NamedApiRouteContext = Readonly<{
  /** Key of the site serving the document; `undefined` in single-site mode. */
  site: string | undefined;
  /** Whether the viewer is signed out. Always `true` when `web.session` is not configured. */
  guest: boolean;
}>;

/** One registered named API route, as `web.namedApiRoutes` filters see it. */
export type NamedApiRouteCandidate = Readonly<{
  name: string;
  path: string;
  method: string;
  /** The sites the route declared (`sites` route or group option); `undefined` means shared. */
  sites: readonly string[] | undefined;
  /** Whether an auth guard is in the route's middleware chain, group middleware included. */
  guarded: boolean;
}>;

/** Return `true` to let the route into this viewer's table. */
export type NamedApiRoutesFilter = (
  route: NamedApiRouteCandidate,
  context: NamedApiRouteContext,
) => boolean;

/**
 * What a page may embed, on top of the routes its own code reaches: route
 * names, with `"prefix.*"` patterns, or a filter function.
 */
export type NamedApiRoutesInclude = readonly string[] | NamedApiRoutesFilter;

/** The object form of `web.namedApiRoutes`. */
export type NamedApiRoutesConfig = {
  /** Narrows the table to these names or this filter. Absent admits every reached route. */
  include?: NamedApiRoutesInclude;
  /**
   * Path prefixes whose routes are never embedded, for any viewer and any site,
   * e.g. `["/api/admin/", "/api/webhooks/"]`. Matched by whole path segments.
   */
  privatePrefixes?: readonly string[];
};

/**
 * `web.namedApiRoutes`: how the server builds each page's browser route table.
 *
 * - `false`: embed nothing. `apiHref()` and `useSubmitForm({ route })` throw
 *   (in development, naming this option); explicit paths keep working.
 * - an allowlist or a filter function: shorthand for `{ include }`.
 * - `{ include, privatePrefixes }`: both.
 *
 * Every form only ever removes routes: a page still embeds just the routes its
 * client code reaches, minus `clientVisible: false` routes, routes declared
 * for other sites, and (for a guest) routes behind an auth guard.
 */
export type NamedApiRoutesOption = false | NamedApiRoutesInclude | NamedApiRoutesConfig;
