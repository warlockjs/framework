import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { normalizeEntry } from "./normalize-entry";
import { shardFileName } from "./shard-name";
import type { ResolvedSitemapEntry, SitemapOptions } from "./types";
import type { DuplicatePathTracker } from "./duplicate-path-tracker";
import type { RouteCounter } from "./route-counter";
import type { SitemapSourceFactory } from "./sitemap-index-types";
import { buildSitemapXml, IMAGE_NAMESPACE_ATTR, renderUrlBlock, XHTML_NAMESPACE_ATTR } from "./xml";

/** One `addSource` group: the unnamed group merges every unkeyed call; a keyed group holds exactly one factory. */
export type ShardGroup = {
  readonly key?: string;
  readonly factories: readonly SitemapSourceFactory[];
};

export type ShardWriterContext = {
  readonly tempDir: string;
  readonly baseUrl: string;
  readonly filePrefix: string;
  readonly gzip: boolean;
  readonly maxUrlsPerFile: number;
  readonly maxBytesPerFile: number;
  readonly defaults: Pick<
    SitemapOptions,
    "changefreq" | "priority" | "lastmod" | "onImageLimitExceeded"
  >;
  readonly duplicates: DuplicatePathTracker;
  readonly routes: RouteCounter;
};

/** A shard actually written, or the zero-url row reported for a group that produced nothing. */
export type ShardFile = {
  readonly fileName: string;
  readonly key?: string;
  readonly urls: number;
  readonly bytes: number;
  readonly gzipped: boolean;
};

function envelopeBytes(baseUrl: string): number {
  return Buffer.byteLength(buildSitemapXml([], baseUrl), "utf8");
}

/**
 * The extra bytes `<urlset>` gains for `xmlns:xhtml="…"` once a shard holds
 * an entry with alternates. Charged separately from `envelopeBytes()` so the
 * ceiling check can add it exactly once — the moment the first alternate
 * enters the buffer — rather than missing it entirely, which would let a
 * shard's real bytes on disk exceed the ceiling it was rolled against.
 */
const NAMESPACE_BYTES = Buffer.byteLength(XHTML_NAMESPACE_ATTR, "utf8");
const IMAGE_NAMESPACE_BYTES = Buffer.byteLength(IMAGE_NAMESPACE_ATTR, "utf8");

async function writeShardFile(
  ctx: ShardWriterContext,
  fileName: string,
  entries: readonly ResolvedSitemapEntry[],
): Promise<{ bytes: number }> {
  const xml = buildSitemapXml(entries, ctx.baseUrl);
  const filePath = join(ctx.tempDir, fileName);

  if (ctx.gzip) {
    const compressed = gzipSync(Buffer.from(xml, "utf8"));

    await writeFile(filePath, compressed);

    return { bytes: compressed.byteLength };
  }

  await writeFile(filePath, xml, "utf8");

  return { bytes: Buffer.byteLength(xml, "utf8") };
}

/**
 * Walks one group's factories, one at a time, rolling to a new shard on
 * whichever ceiling — URL count or serialised bytes — is hit first. Holds
 * only the current shard's buffer, never the whole group.
 */
export async function writeShardGroup(
  group: ShardGroup,
  ctx: ShardWriterContext,
): Promise<ShardFile[]> {
  const results: ShardFile[] = [];

  let buffer: ResolvedSitemapEntry[] = [];
  let bufferBytes = envelopeBytes(ctx.baseUrl);
  // Charged once, the moment the buffer's first alternate-bearing entry is added — mirrors
  // buildSitemapXml()'s own "at least one entry has alternates" rule for the same shard.
  let bufferHasAlternates = false;
  let bufferHasImages = false;
  let ordinal = 1;

  const flush = async () => {
    if (buffer.length === 0) return;

    const fileName = shardFileName(ctx.filePrefix, group.key, ordinal, ctx.gzip);
    const { bytes } = await writeShardFile(ctx, fileName, buffer);

    results.push({ fileName, key: group.key, urls: buffer.length, bytes, gzipped: ctx.gzip });

    ordinal += 1;
    buffer = [];
    bufferBytes = envelopeBytes(ctx.baseUrl);
    bufferHasAlternates = false;
    bufferHasImages = false;
  };

  for (const factory of group.factories) {
    const source = await factory();

    for await (const rawEntry of source) {
      const resolved = normalizeEntry(rawEntry, ctx.defaults);

      // Duplicate paths are SKIPPED, not overridden: the earlier one is already on disk.
      if (!ctx.duplicates.attempt(resolved.path, resolved.route)) continue;

      const entryHasAlternates = (resolved.alternates?.length ?? 0) > 0;
      const entryHasImages = (resolved.images?.length ?? 0) > 0;
      const blockBytes = Buffer.byteLength(renderUrlBlock(resolved, ctx.baseUrl), "utf8") + 1;
      // What this entry would add to the CURRENT shard: its own block, plus the namespace
      // attribute if this is the shard's first alternate and the buffer doesn't carry it yet.
      const addedBytes =
        blockBytes +
        (entryHasAlternates && !bufferHasAlternates ? NAMESPACE_BYTES : 0) +
        (entryHasImages && !bufferHasImages ? IMAGE_NAMESPACE_BYTES : 0);

      const hitsUrlCeiling = buffer.length >= ctx.maxUrlsPerFile;
      // A single entry can never be split, so the byte ceiling only rolls an already-nonempty shard.
      const hitsByteCeiling = buffer.length > 0 && bufferBytes + addedBytes > ctx.maxBytesPerFile;

      if (hitsUrlCeiling || hitsByteCeiling) await flush();

      const addsNamespaceNow = entryHasAlternates && !bufferHasAlternates;
      const addsImageNamespaceNow = entryHasImages && !bufferHasImages;

      buffer.push(resolved);
      bufferBytes +=
        blockBytes +
        (addsNamespaceNow ? NAMESPACE_BYTES : 0) +
        (addsImageNamespaceNow ? IMAGE_NAMESPACE_BYTES : 0);
      if (addsNamespaceNow) bufferHasAlternates = true;
      if (addsImageNamespaceNow) bufferHasImages = true;
      ctx.routes.record(resolved.route);
    }
  }

  await flush();

  if (results.length === 0) {
    // Reported, never written: an empty shard in an index is a section someone lost.
    results.push({
      fileName: shardFileName(ctx.filePrefix, group.key, 1, ctx.gzip),
      key: group.key,
      urls: 0,
      bytes: 0,
      gzipped: false,
    });
  }

  return results;
}
