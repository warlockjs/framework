import type { SitemapOptions } from "./types";
import { normalizeBaseUrl } from "./url";
import type { SitemapIndexOptions } from "./sitemap-index-types";

/** The sitemaps.org limits. Never clamped to — a silently clamped option is a lie about what was written. */
export const PROTOCOL_MAX_URLS_PER_FILE = 50_000;
export const PROTOCOL_MAX_BYTES_PER_FILE = 50 * 1024 * 1024;

export type ResolvedSitemapIndexOptions = {
  readonly baseUrl: string;
  readonly filePrefix: string;
  readonly indexFileName: string;
  readonly shardPathPrefix: string;
  readonly gzip: boolean;
  readonly maxUrlsPerFile: number;
  readonly maxBytesPerFile: number;
  readonly defaults: Pick<
    SitemapOptions,
    "changefreq" | "priority" | "lastmod" | "onImageLimitExceeded"
  >;
};

/** Validates and folds in defaults, once, at the constructor — the same discipline as `Sitemap`. */
export function normalizeSitemapIndexOptions(
  options: SitemapIndexOptions,
): ResolvedSitemapIndexOptions {
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const shardPathPrefix = normalizeShardPathPrefix(options.shardPathPrefix);

  const maxUrlsPerFile = options.maxUrlsPerFile ?? PROTOCOL_MAX_URLS_PER_FILE;
  const maxBytesPerFile = options.maxBytesPerFile ?? PROTOCOL_MAX_BYTES_PER_FILE;

  if (
    !Number.isInteger(maxUrlsPerFile) ||
    maxUrlsPerFile < 1 ||
    maxUrlsPerFile > PROTOCOL_MAX_URLS_PER_FILE
  ) {
    throw new RangeError(
      `maxUrlsPerFile must be an integer between 1 and the sitemaps.org ceiling of ` +
        `${PROTOCOL_MAX_URLS_PER_FILE}, got ${JSON.stringify(maxUrlsPerFile)}.`,
    );
  }

  if (
    !Number.isFinite(maxBytesPerFile) ||
    maxBytesPerFile < 1 ||
    maxBytesPerFile > PROTOCOL_MAX_BYTES_PER_FILE
  ) {
    throw new RangeError(
      `maxBytesPerFile must be between 1 and the sitemaps.org ceiling of ` +
        `${PROTOCOL_MAX_BYTES_PER_FILE} bytes, got ${JSON.stringify(maxBytesPerFile)}.`,
    );
  }

  return {
    baseUrl,
    filePrefix: options.filePrefix ?? "sitemap",
    indexFileName: options.indexFileName ?? "sitemap_index.xml",
    shardPathPrefix,
    gzip: options.gzip ?? false,
    maxUrlsPerFile,
    maxBytesPerFile,
    defaults: {
      changefreq: options.changefreq,
      priority: options.priority,
      lastmod: options.lastmod,
      onImageLimitExceeded: options.onImageLimitExceeded,
    },
  };
}

function normalizeShardPathPrefix(value: string | undefined): string {
  if (value === undefined || value === "" || value === "/") return "";

  const prefix = value.replace(/^\//, "").replace(/\/$/, "");
  if (
    prefix.length === 0 ||
    prefix.split("/").some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new TypeError("shardPathPrefix must contain only safe URL path segments.");
  }

  return `${prefix}/`;
}
