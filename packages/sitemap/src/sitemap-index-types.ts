import type {
  ChangeFreq,
  DuplicateReport,
  RouteSummary,
  SitemapEntry,
  SitemapImageLimitExceeded,
} from "./types";

/** What a source factory produces: one walk over a group's entries. */
export type SitemapSource = Iterable<SitemapEntry> | AsyncIterable<SitemapEntry>;

/**
 * A FACTORY, not a bare iterable. An async iterable can only be walked once,
 * so it cannot survive a retry, a second `saveTo()`, or a failed run that has
 * to rebuild the whole set — the factory can simply be called again.
 */
export type SitemapSourceFactory = () => SitemapSource | Promise<SitemapSource>;

export type SitemapIndexOptions = {
  /** Absolute origin, validated exactly as `Sitemap` validates it. */
  readonly baseUrl: string;
  /** Shard file name prefix. Default `sitemap`, giving `sitemap-0001.xml`. */
  readonly filePrefix?: string;
  /** Index file name. Default `sitemap_index.xml`. */
  readonly indexFileName?: string;
  /** URL directory for shard links, independent of their on-disk directory. */
  readonly shardPathPrefix?: string;
  /** Write `.xml.gz` beside each shard and point the index at it. Default false. */
  readonly gzip?: boolean;
  /** Hard ceiling per shard. Default 50_000; never accepted above the protocol ceiling. */
  readonly maxUrlsPerFile?: number;
  /** Hard ceiling per shard in bytes, uncompressed. Default 50 * 1024 * 1024. */
  readonly maxBytesPerFile?: number;
  readonly changefreq?: ChangeFreq;
  readonly priority?: number;
  readonly lastmod?: string | Date;
  /** Called once per route when an entry exceeds Google's 1,000-image limit. */
  readonly onImageLimitExceeded?: (event: SitemapImageLimitExceeded) => void;
};

export type SitemapSetResult = {
  readonly indexPath: string;
  readonly files: readonly SitemapFileResult[];
  readonly totalUrls: number;
  readonly duplicates: readonly DuplicateReport[];
  readonly routes: readonly RouteSummary[];
};

export type SitemapFileResult = {
  readonly path: string;
  /** The source key this shard came from, when the source was named. */
  readonly key?: string;
  readonly urls: number;
  readonly bytes: number;
  readonly gzipped: boolean;
};
