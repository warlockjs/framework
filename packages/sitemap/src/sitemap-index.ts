import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { DuplicateSourceKeyError } from "./errors";
import {
  normalizeSitemapIndexOptions,
  type ResolvedSitemapIndexOptions,
} from "./sitemap-index-options";
import { canonicalizeSourceKey } from "./shard-name";
import { publishAtomically } from "./atomic-publish";
import { writeShardGroup, type ShardFile, type ShardGroup } from "./sitemap-shard-writer";
import { buildSitemapIndexXml } from "./sitemap-index-xml";
import { DuplicatePathTracker } from "./duplicate-path-tracker";
import { RouteCounter } from "./route-counter";
import type {
  SitemapFileResult,
  SitemapIndexOptions,
  SitemapSetResult,
  SitemapSourceFactory,
} from "./sitemap-index-types";

/**
 * The streaming path for 300–500K URLs: shards, one flat master index, gzip,
 * and an atomic publish. It is a SECOND mode, not a bigger `Sitemap` — it
 * retains only the current shard's buffer and the set of paths it has seen.
 * There is no `entries()`, `toXML()` or `size`; anyone who can afford those
 * is in `Sitemap` and should be there instead.
 */
export class SitemapIndex {
  private readonly options: ResolvedSitemapIndexOptions;

  /** Every unnamed `addSource(factory)` call merges into this one group, sharing one shard counter. */
  private readonly unnamedFactories: SitemapSourceFactory[] = [];

  private readonly namedGroups: ShardGroup[] = [];

  /** Canonical (lowercased) keys already registered, so a case collision is caught at `addSource()`. */
  private readonly registeredKeys = new Set<string>();

  public constructor(options: SitemapIndexOptions) {
    this.options = normalizeSitemapIndexOptions(options);
  }

  public addSource(source: SitemapSourceFactory): this;
  public addSource(key: string, source: SitemapSourceFactory): this;
  public addSource(
    keyOrSource: string | SitemapSourceFactory,
    maybeSource?: SitemapSourceFactory,
  ): this {
    if (typeof keyOrSource === "string") {
      const canonicalKey = canonicalizeSourceKey(keyOrSource);

      if (this.registeredKeys.has(canonicalKey)) {
        throw new DuplicateSourceKeyError(keyOrSource);
      }

      this.registeredKeys.add(canonicalKey);
      this.namedGroups.push({ key: keyOrSource, factories: [maybeSource as SitemapSourceFactory] });
    } else {
      this.unnamedFactories.push(keyOrSource);
    }

    return this;
  }

  /**
   * Walks every group one at a time — never all at once — into a sibling
   * temp directory, then publishes the whole set atomically. `files` is
   * reported in registration order: the unnamed group first (if any), then
   * named groups key-then-ordinal.
   */
  public async saveTo(outDir: string): Promise<SitemapSetResult> {
    const groups: ShardGroup[] = [
      ...(this.unnamedFactories.length > 0
        ? [{ key: undefined, factories: this.unnamedFactories }]
        : []),
      ...this.namedGroups,
    ];

    const duplicates = new DuplicatePathTracker();
    const routes = new RouteCounter();
    let shardFiles: ShardFile[] = [];

    const write = async (tempDir: string): Promise<readonly string[]> => {
      shardFiles = [];

      for (const group of groups) {
        const files = await writeShardGroup(group, {
          tempDir,
          baseUrl: this.options.baseUrl,
          filePrefix: this.options.filePrefix,
          gzip: this.options.gzip,
          maxUrlsPerFile: this.options.maxUrlsPerFile,
          maxBytesPerFile: this.options.maxBytesPerFile,
          defaults: this.options.defaults,
          duplicates,
          routes,
        });

        shardFiles.push(...files);
      }

      const indexXml = buildSitemapIndexXml(shardFiles, this.options.baseUrl);

      await writeFile(join(tempDir, this.options.indexFileName), indexXml, "utf8");

      const writtenShardNames = shardFiles
        .filter((file) => file.urls > 0)
        .map((file) => file.fileName);

      return [...writtenShardNames, this.options.indexFileName];
    };

    await publishAtomically(outDir, write);

    const files: SitemapFileResult[] = shardFiles.map((file) => ({
      path: join(outDir, file.fileName),
      ...(file.key !== undefined ? { key: file.key } : {}),
      urls: file.urls,
      bytes: file.bytes,
      gzipped: file.gzipped,
    }));

    return {
      indexPath: join(outDir, this.options.indexFileName),
      files,
      totalUrls: files.reduce((total, file) => total + file.urls, 0),
      duplicates: duplicates.report(),
      routes: routes.summary(),
    };
  }
}
