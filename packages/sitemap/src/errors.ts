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
