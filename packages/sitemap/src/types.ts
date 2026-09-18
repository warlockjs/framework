/** The `<changefreq>` values the sitemap protocol defines. */
export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

/**
 * One language version of a page, serialised as
 * `<xhtml:link rel="alternate" hreflang="…" href="…"/>`.
 *
 * `hreflang` is not interpreted: `en`, `en-GB` and `x-default` are all just
 * values. This package understands the PROTOCOL concept of an alternate; it
 * does not understand anybody's locale system, and it never derives a
 * locale-prefixed path for you.
 */
export type SitemapAlternate = {
  readonly hreflang: string;
  /** A path resolved against `baseUrl`, or an absolute URL used as given. */
  readonly path: string;
};

/**
 * One `<url>` block. Only `path` is required; `name` and `route` are carried
 * for the diagnostics in `routes()` and `duplicates()` and never serialised.
 */
export type SitemapEntry = {
  /** The CONCRETE path: `/posts/123`. A pattern is not a URL. */
  readonly path: string;
  /** Optional label for the route this came from: `post-details`. */
  readonly name?: string;
  /** Optional pattern this came from: `/posts/:id`. */
  readonly route?: string;
  readonly lastmod?: string | Date;
  readonly changefreq?: ChangeFreq;
  readonly priority?: number;
  /** Language versions of THIS page, conventionally including itself. */
  readonly alternates?: readonly SitemapAlternate[];
};

/**
 * An entry after normalisation: the path carries its leading slash, the
 * builder's defaults have been folded in, and `lastmod` is always the
 * serialised string — a `Date` is resolved once, at `add()`, so `toXML()`
 * stays pure and repeatable.
 */
export type ResolvedSitemapEntry = Omit<SitemapEntry, "lastmod"> & {
  readonly lastmod?: string;
};

export type SitemapOptions = {
  /** Absolute origin: `https://example.com` or `https://example.com/base`. */
  readonly baseUrl: string;
  /** Applied to every entry that does not set its own. */
  readonly changefreq?: ChangeFreq;
  readonly priority?: number;
  readonly lastmod?: string | Date;
};

/**
 * How many URLs a route contributed. A `count: 0` row is the interesting one:
 * the route was declared and produced nothing, so a whole section is missing.
 */
export type RouteSummary = {
  readonly route: string;
  readonly count: number;
};

/**
 * A path that was added more than once. The later add wins silently, so this
 * is the only way a caller can see it happened.
 */
export type DuplicateReport = {
  readonly path: string;
  /** Always >= 2. */
  readonly count: number;
  /** The `route` of each add, in order, so colliding sources are nameable. */
  readonly routes: readonly (string | undefined)[];
};
