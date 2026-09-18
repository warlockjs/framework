/**
 * The `baseUrl` given to a `Sitemap` is not an absolute http(s) URL.
 *
 * Thrown from the CONSTRUCTOR: a sitemap that cannot produce a valid URL
 * should not exist, and the mistake belongs at the line that wrote the value
 * rather than at the first request that reads it.
 */
export class InvalidBaseUrlError extends Error {
  public constructor(value: unknown, reason: string) {
    super(`Invalid sitemap baseUrl ${JSON.stringify(value)}: ${reason}.`);
    this.name = "InvalidBaseUrlError";
  }
}

/** An entry the sitemap protocol cannot represent. Thrown from `add()`. */
export class InvalidSitemapEntryError extends Error {
  public constructor(reason: string) {
    super(`Invalid sitemap entry: ${reason}.`);
    this.name = "InvalidSitemapEntryError";
  }
}

/**
 * Two `SitemapIndex` source keys collide once canonicalised (`en-US` and
 * `en-us` would produce the same filename on a case-insensitive filesystem
 * and silently overwrite one another). Thrown from `addSource()`, not at
 * `saveTo()`, so the mistake is caught at the line that registered it.
 */
export class DuplicateSourceKeyError extends Error {
  public constructor(key: string) {
    super(
      `Duplicate sitemap source key ${JSON.stringify(key)}: keys collide case-insensitively ` +
        `and would overwrite one another's shard files.`,
    );
    this.name = "DuplicateSourceKeyError";
  }
}

/**
 * `SitemapIndex.saveTo(outDir)` swaps the ENTIRE `outDir` for a freshly
 * written set (`atomic-publish.ts`). That is safe only when `outDir` is a
 * directory this package already owns — marked by its own
 * `.sitemap-set.json` from a prior publish. A non-empty directory with no
 * marker is presumed to belong to someone else (a caller's `public/`, most
 * dangerously) and is never swapped or deleted; this is thrown instead, from
 * `saveTo()` before anything is written.
 */
export class UnownedOutputDirectoryError extends Error {
  public constructor(outDir: string) {
    super(
      `Refusing to publish a sitemap set to ${JSON.stringify(outDir)}: this directory already ` +
        `has content but no ".sitemap-set.json" marker from a previous @warlock.js/sitemap ` +
        `publish, so it is not safe to swap or delete. Point saveTo() at a dedicated, ` +
        `sitemap-only directory instead.`,
    );
    this.name = "UnownedOutputDirectoryError";
  }
}
