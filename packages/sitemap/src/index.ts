/**
 * @warlock.js/sitemap — runtime sitemap.xml generation.
 *
 * Built at RUNTIME, against the application's own page registry and page
 * `metadata`/`sitemap` exports — not at build time, which can read neither.
 */

export type { ChangeFreq, SitemapConfig, SitemapDefaults, SitemapEntries, SitemapEntry } from "./types";
export type { RoutablePage, SitemapPageExport } from "./routable-page";

export {
  collectSitemapEntries,
  isDynamicRoutePath,
  type CollectSitemapEntriesOptions,
  type CollectSitemapEntriesResult,
} from "./collect-entries";

export { describeUnresolvedDynamicRoutes } from "./diagnostic";

export { buildSitemapXml, escapeXml } from "./xml";

export { joinOrigin, MissingPublicUrlError, resolveOrigin, type ResolveOriginOptions } from "./url";
