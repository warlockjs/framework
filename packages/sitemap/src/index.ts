/**
 * @warlock.js/sitemap — a framework-blind sitemap builder.
 *
 * It owns the sitemap PROTOCOL and every byte it emits, and it knows nothing
 * about Warlock: no page registry, no config module, no lifecycle. The web
 * integration is a CALLER, which is why this package is usable from a plain
 * Node script or an Express app just as it is from a Warlock project.
 */

export { Sitemap } from "./sitemap";

export { InvalidBaseUrlError, InvalidSitemapEntryError } from "./errors";

export type {
  ChangeFreq,
  DuplicateReport,
  ResolvedSitemapEntry,
  RouteSummary,
  SitemapAlternate,
  SitemapEntry,
  SitemapOptions,
} from "./types";

export { buildSitemapXml, escapeXml } from "./xml";

export { joinOrigin } from "./url";
