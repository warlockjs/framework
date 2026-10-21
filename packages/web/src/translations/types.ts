/**
 * The translation delivery contract shared by the build, the server and the
 * browser. Client-safe: this file imports nothing at run time, so the browser
 * bundle can read these shapes without pulling in the build or the server.
 */

/**
 * Translation groups every page can use: their keys ship once per locale as a
 * hashed, immutable asset instead of inside each page's payload. A group is the
 * first segment of a key (`app.title` belongs to `app`).
 */
export const DEFAULT_SHARED_TRANSLATION_GROUPS: readonly string[] = Object.freeze([
  "app",
  "common",
]);

/** The public path segment under `/assets/` that hashed translation tables live in. */
export const TRANSLATION_ASSET_DIRECTORY = "translations";

/**
 * Where a page's translations come from, as the hydration payload carries
 * them.
 *
 * `url` is the locale's shared-groups table. `hash` identifies its content: in
 * production a content hash (the URL changes with the content, so the response
 * can be cached forever), in development a revision (the response is fresh on
 * every load). `groups` says which top-level groups the table provides to the
 * dictionary. `development` marks the full-table asset that the missing-key
 * detector reads.
 */
export type HydrationTranslationAssets = {
  readonly url: string;
  readonly hash: string;
  readonly groups: readonly string[];
  readonly development?: boolean;
};

/** A translation usage in the form the production manifest stores it. */
export type SerializedTranslationUsage = {
  readonly keys: readonly string[];
  readonly prefixes: readonly string[];
  readonly dynamic: boolean;
};

/**
 * The build-time translation facts the production page barrel carries: which
 * groups are shared, whether pruning is on, and each page's usage keyed by the
 * same `sourceFile` the barrel's page entries use.
 */
export type PageManifestTranslations = {
  readonly sharedGroups: readonly string[];
  readonly prune: boolean;
  readonly usage: Readonly<Record<string, SerializedTranslationUsage>>;
};
