import type { SitemapEntries } from "./types";

/**
 * A page's `sitemap` export: the entries function, an explicit opt-out
 * (`export const sitemap = false`), or absent entirely.
 */
export type SitemapPageExport = SitemapEntries | false | undefined;

/**
 * The minimal facts {@link collectSitemapEntries} (`collect-entries.ts`) needs
 * about one routable page.
 *
 * Deliberately NOT `DiscoveredRoutablePage` from `@warlock.js/web` — that type
 * carries filesystem paths, layout chains and middleware wiring this package
 * has no business reading. The runtime wiring (a separate package, adapting
 * `discoverPages()` and each page module's exports) builds this shape; this
 * package only ever consumes it.
 */
export type RoutablePage = {
  /** Unique route identity — named in the dynamic-route diagnostic when unresolved. */
  routeName: string;
  /** The effective route path, `:param` for a dynamic segment (e.g. `/posts/:id`). */
  routePath: string;
  /** `metadata.robots`, when the page's `metadata` export is a static object. */
  robots?: string;
  sitemap?: SitemapPageExport;
};
