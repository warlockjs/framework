/**
 * The server's half of translation delivery: which keys a page's payload
 * carries, and which hashed shared table the browser fetches.
 *
 * Production and development differ only in where the page usage comes from.
 * Production reads the usage the build computed and carried in the barrel.
 * Development analyzes the page's client graph itself and re-analyzes a page
 * when any file it read has changed, so a new import or a new key is picked up
 * on the next request without a restart.
 */
import fs from "node:fs";
import { analyzePageTranslationUsage, type TranslationUsage } from "@warlock.js/core";
import type { Keywords } from "@mongez/localization";
import {
  assetUrlFor,
  canonicalJson,
  contentHash,
  EVERYTHING_USAGE,
  fullTableFor,
  localeCodesOf,
  pruneKeywords,
  sharedTranslationAssets,
  usageFromRecord,
  type TranslationSourceEntries,
} from "../translations/delivery";
import {
  DEFAULT_SHARED_TRANSLATION_GROUPS,
  type HydrationTranslationAssets,
  type PageManifestTranslations,
} from "../translations/types";

/** The development route that serves a locale's full table, fresh on every load. */
export const DEVELOPMENT_TRANSLATION_ROUTE_PREFIX = "/__warlock/translations";

/** What a page's payload gets for translations: its own pruned dictionary and the shared table reference. */
export type DeliveredTranslations = {
  readonly keywords: Keywords;
  readonly assets: HydrationTranslationAssets | undefined;
};

/** How a render decides what a page ships. Built once per route table. */
export type TranslationDelivery = {
  /** The groups shipped as shared tables. */
  readonly sharedGroups: readonly string[];
  /** What a page can reach, by the page identity the route resolver is called with. */
  usageFor(sourceFile: string): TranslationUsage;
  /** The shared table of one locale, or `undefined` for a locale with no sources. */
  assetFor(locale: string): HydrationTranslationAssets | undefined;
};

/** Production: the usage the build computed, and the shared tables the build emitted. */
export function productionTranslationDelivery(input: {
  readonly sources: readonly TranslationSourceEntries[];
  readonly translations: PageManifestTranslations | undefined;
}): TranslationDelivery {
  const sharedGroups = input.translations?.sharedGroups ?? DEFAULT_SHARED_TRANSLATION_GROUPS;
  const usage = input.translations?.usage ?? {};
  const assets = new Map(
    sharedTranslationAssets(input.sources, sharedGroups).map((asset) => [
      asset.locale,
      { url: assetUrlFor(asset.fileName), hash: asset.hash, groups: sharedGroups },
    ]),
  );

  return {
    sharedGroups,
    usageFor(sourceFile) {
      if (!Object.hasOwn(usage, sourceFile)) return EVERYTHING_USAGE;
      return usageFromRecord(usage[sourceFile] ?? { keys: [], prefixes: [], dynamic: true });
    },
    assetFor: (locale) => assets.get(locale),
  };
}

/** The render inputs of one development page: what its client graph starts from. */
export type DevelopmentPageEntries = {
  readonly pageFile: string;
  readonly entries: readonly string[];
  readonly setupFiles: readonly string[];
};

/** A cached development analysis, valid while every file it read keeps its modification time. */
type CachedUsage = {
  readonly usage: TranslationUsage;
  readonly files: readonly string[];
  readonly stamp: string;
};

function fileStamp(files: readonly string[]): string {
  return files.map((file) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1).join(",");
}

/**
 * Development: analyze each page's client graph on demand, re-analyzing it
 * when any file it read has changed. The shared table is the FULL table for
 * the development build (`development: true`), so the browser's missing-key
 * detector can tell a pruned key from one that does not exist.
 */
export function developmentTranslationDelivery(input: {
  readonly sources: readonly TranslationSourceEntries[];
  readonly appSrcRoot: string;
  readonly pages: readonly DevelopmentPageEntries[];
}): TranslationDelivery {
  const sharedGroups = DEFAULT_SHARED_TRANSLATION_GROUPS;
  const pages = new Map(input.pages.map((page) => [page.pageFile, page]));
  const cache = new Map<string, CachedUsage>();
  const assets = new Map<string, HydrationTranslationAssets>();

  for (const locale of localeCodesOf(input.sources)) {
    const revision = contentHash(canonicalJson(fullTableFor(input.sources, locale)));
    assets.set(locale, {
      url: `${DEVELOPMENT_TRANSLATION_ROUTE_PREFIX}/${encodeURIComponent(locale)}?v=${revision}`,
      hash: revision,
      groups: sharedGroups,
      development: true,
    });
  }

  return {
    sharedGroups,
    usageFor(sourceFile) {
      const page = pages.get(sourceFile);
      if (page === undefined) return EVERYTHING_USAGE;

      const cached = cache.get(sourceFile);
      if (cached !== undefined && cached.stamp === fileStamp(cached.files)) return cached.usage;

      const { usage, files } = analyzePageTranslationUsage({
        appSrcRoot: input.appSrcRoot,
        entries: page.entries,
        setupFiles: page.setupFiles,
      });
      cache.set(sourceFile, { usage, files, stamp: fileStamp(files) });

      return usage;
    },
    assetFor: (locale) => assets.get(locale),
  };
}

/**
 * The page's payload translations for one locale. Pruned to the usage, minus
 * the shared groups, together with the reference to the shared table.
 */
export function deliverTranslations(
  delivery: TranslationDelivery,
  sourceFile: string,
  locale: string,
  keywords: Readonly<Keywords>,
): DeliveredTranslations {
  return {
    keywords: pruneKeywords(keywords, delivery.usageFor(sourceFile), delivery.sharedGroups),
    assets: delivery.assetFor(locale),
  };
}

/** The full table of one locale, the body the development route serves. */
export function developmentTableBody(
  sources: readonly TranslationSourceEntries[],
  locale: string,
): string {
  return canonicalJson(fullTableFor(sources, locale));
}
