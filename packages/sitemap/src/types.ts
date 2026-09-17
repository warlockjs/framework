/** The `<changefreq>` values the sitemap protocol defines. */
export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

/**
 * One `<url>` block. `path` is app-relative (`/posts/hello-world`) — this
 * package joins it against the configured origin; see `url.ts`.
 */
export type SitemapEntry = {
  path: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
};

/**
 * A page's `sitemap` export, when it is a function: produces the entries a
 * dynamic route stands for. Runs server-side, at sitemap-build time — not
 * per-request.
 */
export type SitemapEntries = () => SitemapEntry[] | Promise<SitemapEntry[]>;

/** Fallback `changefreq`/`priority` applied to any entry that omits them. */
export type SitemapDefaults = {
  changefreq?: ChangeFreq;
  priority?: number;
};

/** `src/config/sitemap.ts` — written by `warlock add sitemap`. */
export type SitemapConfig = {
  enabled: boolean;
  path: string;
  defaults?: SitemapDefaults;
};
