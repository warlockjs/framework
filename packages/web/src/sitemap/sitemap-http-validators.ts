import { evaluateConditionalRequest } from "@warlock.js/core";

/**
 * Pure conditional-request metadata for an already generated sitemap file.
 *
 * The route owns reading headers and writing a response. This helper owns only
 * RFC HTTP validator precedence, so generation, storage, and cache drivers do
 * not enter the request path.
 */
export type SitemapHttpValidatorInput = {
  /** SHA-256 of the exact bytes that will be served. */
  readonly sha256: string;
  /** Time that those bytes became the current committed generation. */
  readonly generatedAt: Date | number | string;
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
  /** Conditional semantics apply to GET and HEAD; defaults to GET. */
  readonly method?: "GET" | "HEAD" | string;
  /** Browser-cache policy for the generated immutable-until-regenerated file. */
  readonly cacheControl?: string;
};

export type SitemapHttpValidators = {
  readonly etag: string;
  readonly lastModified: string;
  readonly cacheControl: string;
  /** Whether a GET or HEAD may return 304 with these response headers. */
  readonly notModified: boolean;
  /** Whether `If-Match` failed (strong comparison), so the answer is 412. */
  readonly preconditionFailed: boolean;
};

export const DEFAULT_SITEMAP_CACHE_CONTROL = "public, max-age=300";

function toSecond(date: Date | number | string): number {
  const milliseconds = date instanceof Date ? date.getTime() : new Date(date).getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Sitemap generation date must be a valid date.");
  }

  return Math.floor(milliseconds / 1_000) * 1_000;
}

/**
 * Builds strong validators for generated sitemap bytes and evaluates optional
 * conditional request headers. If-None-Match is deliberately authoritative:
 * when present, If-Modified-Since is never consulted.
 */
export function resolveSitemapHttpValidators(
  input: SitemapHttpValidatorInput,
): SitemapHttpValidators {
  const generatedAt = toSecond(input.generatedAt);
  const etag = `"${input.sha256}"`;
  // RFC 9110 §13.2.2 precedence, with weak If-None-Match and strong If-Match
  // comparison (§13.1); core owns the comparison so every server path agrees.
  const outcome = evaluateConditionalRequest({
    method: input.method ?? "GET",
    etag,
    lastModified: generatedAt,
    ifMatch: input.ifMatch,
    ifNoneMatch: input.ifNoneMatch,
    ifModifiedSince: input.ifModifiedSince,
  });

  return {
    etag,
    lastModified: new Date(generatedAt).toUTCString(),
    cacheControl: input.cacheControl ?? DEFAULT_SITEMAP_CACHE_CONTROL,
    notModified: outcome === "not-modified",
    preconditionFailed: outcome === "precondition-failed",
  };
}
