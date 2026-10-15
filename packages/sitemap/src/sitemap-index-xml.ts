import { escapeXml } from "./xml";
import { joinOrigin } from "./url";
import type { ShardFile } from "./sitemap-shard-writer";

/**
 * Serialises the flat master `sitemapindex` document: every shard of every
 * group, directly, in the order the groups and shards were produced — no
 * nested per-group indexes, and never a zero-url row (that is a diagnostic
 * for `files`, not something a crawler should be told to fetch).
 */
export function buildSitemapIndexXml(
  files: readonly ShardFile[],
  baseUrl: string,
  shardPathPrefix = "",
): string {
  const body = files
    .filter((file) => file.urls > 0)
    .map((file) => {
      const loc = escapeXml(joinOrigin(baseUrl, `${shardPathPrefix}${file.fileName}`));

      return `  <sitemap>\n    <loc>${loc}</loc>\n  </sitemap>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (body.length > 0 ? `${body}\n` : "") +
    `</sitemapindex>\n`
  );
}
