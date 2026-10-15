import { config } from "../config";

/**
 * The application's public origin — the ONE absolute-URL source every
 * consumer that needs one (the sitemap route, canonical links, OG tags,
 * absolute URLs in mail) reads instead of each keeping its own copy.
 *
 * `app.publicUrl` wins over the `PUBLIC_APP_URL` env fallback. Deliberately
 * does not fall back further to a request-derived origin: a sitemap (or any
 * other absolute URL) served from the wrong host is worse than a boot that
 * refuses to start, because nothing downstream ever tells you it was wrong.
 *
 * Optional in general — most apps have no consumer that needs it yet.
 * Returns `undefined` rather than throwing; a consumer that requires the
 * value (e.g. the sitemap route, at boot) is responsible for failing loudly
 * itself, naming both `app.publicUrl` and `PUBLIC_APP_URL`.
 */
export function getPublicUrl(): string | undefined {
  return config.key<string | undefined>("app.publicUrl") || process.env.PUBLIC_APP_URL || undefined;
}
