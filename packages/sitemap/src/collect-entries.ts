import type { RoutablePage } from "./routable-page";
import type { SitemapDefaults, SitemapEntry } from "./types";

const DYNAMIC_SEGMENT = /(^|\/):[A-Za-z_][A-Za-z0-9_]*/;

/** A route path carries a dynamic segment (`[id]` -> `:id`) it cannot enumerate on its own. */
export function isDynamicRoutePath(routePath: string): boolean {
  return DYNAMIC_SEGMENT.test(routePath);
}

function isNoindex(robots: string | undefined): boolean {
  return robots !== undefined && /noindex/i.test(robots);
}

/** Applies the config's `defaults` to any entry that omits `changefreq`/`priority` — shared by page-derived and app-supplied entries alike. */
export function withDefaults(entry: SitemapEntry, defaults: SitemapDefaults | undefined): SitemapEntry {
  return {
    ...entry,
    changefreq: entry.changefreq ?? defaults?.changefreq,
    priority: entry.priority ?? defaults?.priority,
  };
}

/**
 * Combines page-derived entries with app-supplied ones (`SitemapConnectorOptions.entries`),
 * deduplicating by `path`. App-supplied entries are ADDED, not substituted — an
 * app with both a page graph and extra URLs (e.g. rows the page graph can't
 * see) wants both — but where the same path appears in both, the app-supplied
 * entry wins, since it was written for that exact path on purpose.
 */
export function mergeSitemapEntries(
  pageEntries: readonly SitemapEntry[],
  appEntries: readonly SitemapEntry[],
): SitemapEntry[] {
  const byPath = new Map<string, SitemapEntry>();

  for (const entry of pageEntries) byPath.set(entry.path, entry);
  for (const entry of appEntries) byPath.set(entry.path, entry);

  return Array.from(byPath.values());
}

export type CollectSitemapEntriesOptions = {
  defaults?: SitemapDefaults;
};

export type CollectSitemapEntriesResult = {
  entries: SitemapEntry[];
  /** Route names of dynamic routes with no `sitemap` export — feed to `describeUnresolvedDynamicRoutes`. */
  unresolvedDynamicRoutes: string[];
};

/**
 * Walks the routable pages and produces the entries + the unresolved-dynamic
 * diagnostic input, applying every exclusion rule:
 *
 * - `metadata.robots` says `noindex` -> excluded.
 * - `sitemap: false` -> excluded.
 * - a `sitemap` export (any route) -> its returned entries, in place of the
 *   page's own route path.
 * - a dynamic route with no `sitemap` export -> omitted, name collected.
 * - everything else (static routes) -> one entry at the page's own route path.
 *
 * Not-found and error pages are excluded by construction: the caller is
 * expected to hand this only `DiscoveredRoutablePage`-derived entries, and
 * the not-found route is never one of those (`@warlock.js/web`'s discovery
 * reports it as a routable page for the client matcher, but the runtime
 * wiring filters it out before calling here — see the sitemap README).
 */
export async function collectSitemapEntries(
  pages: readonly RoutablePage[],
  options: CollectSitemapEntriesOptions = {},
): Promise<CollectSitemapEntriesResult> {
  const entries: SitemapEntry[] = [];
  const unresolvedDynamicRoutes: string[] = [];

  for (const page of pages) {
    if (isNoindex(page.robots)) continue;
    if (page.sitemap === false) continue;

    if (typeof page.sitemap === "function") {
      const produced = await page.sitemap();

      for (const entry of produced) entries.push(withDefaults(entry, options.defaults));

      continue;
    }

    if (isDynamicRoutePath(page.routePath)) {
      unresolvedDynamicRoutes.push(page.routeName);
      continue;
    }

    entries.push(withDefaults({ path: page.routePath }, options.defaults));
  }

  return { entries, unresolvedDynamicRoutes };
}
