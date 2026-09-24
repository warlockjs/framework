/**
 * @warlock.js/sitemap — a framework-blind sitemap builder.
 *
 * It owns the sitemap PROTOCOL and every byte it emits, and it knows nothing
 * about Warlock: no page registry, no config module, no lifecycle. The web
 * integration is a CALLER, which is why this package is usable from a plain
 * Node script or an Express app just as it is from a Warlock project.
 */

export { Sitemap } from "./sitemap";
export { SitemapIndex } from "./sitemap-index";

export {
  DuplicateSourceKeyError,
  InvalidBaseUrlError,
  InvalidSitemapEntryError,
  UnownedOutputDirectoryError,
} from "./errors";

export type {
  ChangeFreq,
  DuplicateReport,
  ResolvedSitemapEntry,
  RouteSummary,
  SitemapAlternate,
  SitemapEntry,
  SitemapImage,
  SitemapImageLimitExceeded,
  SitemapOptions,
} from "./types";

export type {
  SitemapFileResult,
  SitemapIndexOptions,
  SitemapSetResult,
  SitemapSource,
  SitemapSourceFactory,
} from "./sitemap-index-types";

export { buildSitemapXml, escapeXml, renderUrlBlock } from "./xml";

export { joinOrigin } from "./url";

export {
  GENERATION_MANIFEST_VERSION,
  InvalidSitemapGenerationManifestError,
  MANIFEST_FENCE_WIDTH,
  parseSitemapGenerationManifest,
  parseSitemapManifestKey,
  sitemapManifestKey,
  sortSitemapManifestCandidates,
} from "./generation-manifest";

export type {
  SitemapGenerationFile,
  SitemapGenerationKind,
  SitemapGenerationManifest,
  SitemapManifestKey,
} from "./generation-manifest";
