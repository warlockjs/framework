import { createHash } from "node:crypto";
import { config, type Request } from "@warlock.js/core";
import { Sitemap, type SitemapEntry } from "@warlock.js/sitemap";
import { createSiteSelector, type SiteSelection } from "../sites/site-selector";
import type { SitesConfig } from "../sites/site-config.types";
import { collectSitemapEntries, type CollectedSitemapEntries } from "./collect-sitemap-entries";
import { resolveSitemapConfig } from "./resolve-sitemap-config";
import type { SitemapPageSource } from "./sitemap-page-source";

type MultiSiteWebConfig = {
  sites?: SitesConfig;
  resolveHost?: Parameters<typeof createSiteSelector>[0]["resolveHost"];
  resolveCache?: Parameters<typeof createSiteSelector>[0]["resolveCache"];
  unknownHost?: Parameters<typeof createSiteSelector>[0]["unknownHost"];
};

export type SelectedSitemapSite = Extract<SiteSelection, { kind: "site" }>;

export function multiSiteConfig(): MultiSiteWebConfig | undefined {
  const web = config.get("web", {}) as MultiSiteWebConfig;
  return web.sites === undefined ? undefined : web;
}

export function createSitemapSiteSelector() {
  const web = multiSiteConfig();
  if (!web?.sites) return undefined;

  return createSiteSelector({
    sites: web.sites,
    resolveHost: web.resolveHost,
    resolveCache: web.resolveCache,
    unknownHost: web.unknownHost,
  });
}

/**
 * The selector `/robots.txt` and `/sitemap.xml` fall back to: the same sites
 * without their `basePath`, since those files live at the host root. Built
 * once per route registration, so its `resolveCache` is actually reused.
 */
export function createRootSiteSelector() {
  const web = multiSiteConfig();
  if (!web?.sites) return undefined;
  const sites = Object.fromEntries(
    Object.entries(web.sites).map(([key, site]) => {
      const { basePath: _basePath, ...rootSite } = site;
      return [key, rootSite];
    }),
  ) as SitesConfig;

  return createSiteSelector({
    sites,
    resolveHost: web.resolveHost,
    resolveCache: web.resolveCache,
    unknownHost: web.unknownHost,
  });
}

/** Selects a non-page route with the exact same policy as page dispatch. */
export async function selectSitemapSite(
  request: Request,
  selector = createSitemapSiteSelector(),
  rootSelector?: ReturnType<typeof createRootSiteSelector>,
): Promise<SiteSelection | undefined> {
  if (!selector) return undefined;
  const input = {
    rawHost: request.baseRequest.hostname,
    path: request.path.split("?")[0] || "/",
    request,
  };
  const selected = await selector.select(input);
  if (selected.kind !== "not-found") return selected;

  // `/robots.txt` and `/sitemap.xml` live at the host root, so a site's
  // page-only basePath must not make its own SEO endpoints unselectable.
  const root = rootSelector ?? createRootSiteSelector();
  if (!root) return selected;
  const rootSelected = await root.select(input);
  if (rootSelected.kind === "not-found") return selected;

  const web = multiSiteConfig();
  return {
    ...rootSelected,
    basePath: web?.sites?.[rootSelected.site]?.basePath ?? "",
  };
}

function nonDefaultPort(request: Request): string {
  const host = request.header("host");
  const match = typeof host === "string" ? host.trim().match(/:(\d+)$/) : undefined;
  if (!match) return "";
  const port = match[1];
  if (
    (request.protocol === "https" && port === "443") ||
    (request.protocol === "http" && port === "80")
  )
    return "";
  return `:${port}`;
}

/** The public origin for a selected site, preserving an explicit non-default Host port. */
export function sitemapSiteBaseUrl(request: Request, site: SelectedSitemapSite): string {
  return `${request.protocol}://${site.host}${nonDefaultPort(request)}${site.basePath}`;
}

function removeBasePath(path: string, basePath: string): string {
  if (!basePath || path === basePath) return path === basePath ? "/" : path;
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
}

function localEntry(entry: SitemapEntry, basePath: string): SitemapEntry {
  return {
    ...entry,
    path: removeBasePath(entry.path, basePath),
    ...(entry.alternates === undefined
      ? {}
      : {
          alternates: entry.alternates.map((alternate) => ({
            ...alternate,
            path: removeBasePath(alternate.path, basePath),
          })),
        }),
  };
}

type SiteSitemapSource = {
  site: SelectedSitemapSite;
  appRoot?: string;
  pageSource?: SitemapPageSource;
};

/** Runs the selected site's page sitemap suppliers (the expensive half of a per-site sitemap). */
export async function collectSiteSitemapEntries({
  site,
  appRoot,
  pageSource,
}: SiteSitemapSource): Promise<CollectedSitemapEntries> {
  const web = multiSiteConfig();
  if (!web?.sites) throw new Error("A per-site sitemap requires web.sites.");

  return collectSitemapEntries({
    appRoot: appRoot ?? process.cwd(),
    sites: web.sites,
    locales: resolveSitemapConfig().locales,
    site: site.site,
    pageSource,
    supplierContext: {
      site: site.site,
      ...(site.resolution === undefined
        ? {}
        : { tenantKey: site.resolution.key, shared: site.resolution.shared }),
    },
  });
}

/**
 * Writes collected entries as the in-memory, host-scoped sitemap XML for the
 * request's site origin. Dynamic tenants are never enumerated.
 */
export function renderSiteSitemapXml(
  request: Request,
  site: SelectedSitemapSite,
  collected: CollectedSitemapEntries,
): string {
  const sitemap = new Sitemap({
    baseUrl: sitemapSiteBaseUrl(request, site),
    ...resolveSitemapConfig().defaults,
  });
  for (const item of collected.items) sitemap.add(localEntry(item.entry, site.basePath));
  return sitemap.toXML();
}

export function isNonIndexableDynamicSite(site: SelectedSitemapSite): boolean {
  return site.resolution !== undefined && site.resolution.indexable !== true;
}

/** One built per-site sitemap, as served. */
export type BuiltSiteSitemap = {
  readonly xml: string;
  readonly sha256: string;
  readonly builtAt: number;
};

/** How long a built per-site sitemap is reused when `web.sitemap.regenerateEvery` is unset: 5 minutes. */
export const DEFAULT_SITE_SITEMAP_TTL_MS = 300_000;

/** Most sites/tenants, and most origins, remembered at once. */
const SITE_SITEMAP_CACHE_MAX_ENTRIES = 500;

type Expiring<T> = { expiresAt: number; value: Promise<T> };

/** Drops expired entries, then the oldest, until `map` has room for one more. */
function makeRoom<T>(map: Map<string, Expiring<T>>, maxEntries: number, current: number): void {
  if (map.size < maxEntries) return;

  for (const [key, entry] of map) {
    if (entry.expiresAt <= current) map.delete(key);
  }

  while (map.size >= maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/**
 * Remembers each site's sitemap for `ttlMs`, so `/sitemap.xml` does not run
 * every page's sitemap supplier on each request. The supplier results are
 * kept per site and tenant; the XML per origin on top of them, so a request
 * naming a new host (an `unknownHost` fallback site) costs one XML write, not
 * a new run of the suppliers. Concurrent requests share one build, and a
 * failed build is forgotten at once so the next request retries.
 */
export function createSiteSitemapCache(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? SITE_SITEMAP_CACHE_MAX_ENTRIES;
  const collectedBySite = new Map<string, Expiring<CollectedSitemapEntries>>();
  const builtByOrigin = new Map<
    string,
    Expiring<BuiltSiteSitemap> & { source: Promise<CollectedSitemapEntries> }
  >();

  const remember = <T, E extends Expiring<T>>(map: Map<string, E>, key: string, entry: E) => {
    map.set(key, entry);
    entry.value.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
  };

  return {
    read(
      request: Request,
      site: SelectedSitemapSite,
      collect: () => Promise<CollectedSitemapEntries>,
    ): Promise<BuiltSiteSitemap> {
      const current = now();
      const siteKey = [site.site, site.resolution?.key ?? ""].join("\u0000");
      let collected = collectedBySite.get(siteKey);

      if (collected === undefined || collected.expiresAt <= current) {
        collectedBySite.delete(siteKey);
        makeRoom(collectedBySite, maxEntries, current);

        const ttlMs =
          options.ttlMs ?? resolveSitemapConfig().regenerateEveryMs ?? DEFAULT_SITE_SITEMAP_TTL_MS;

        collected = { expiresAt: current + ttlMs, value: collect() };
        remember(collectedBySite, siteKey, collected);
      }

      const originKey = [siteKey, sitemapSiteBaseUrl(request, site)].join("\u0000");
      const existing = builtByOrigin.get(originKey);

      if (existing !== undefined && existing.source === collected.value) return existing.value;

      builtByOrigin.delete(originKey);
      makeRoom(builtByOrigin, maxEntries, current);

      const source = collected.value;
      const built = source.then((entries) => {
        const xml = renderSiteSitemapXml(request, site, entries);

        return { xml, sha256: createHash("sha256").update(xml).digest("hex"), builtAt: now() };
      });

      remember(builtByOrigin, originKey, { expiresAt: collected.expiresAt, value: built, source });

      return built;
    },
  };
}
