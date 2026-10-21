/**
 * The server's half of translation delivery: which keys a page's payload
 * carries, and which content-addressed table the browser fetches.
 *
 * Production and development differ only in where the page usage comes from.
 * Production reads the usage the build computed and carried in the barrel.
 * Development analyzes the page's client graph itself and re-analyzes a page
 * when any file it read has changed, so a new import or key is picked up on
 * the next request without a restart.
 *
 * A scoped (route dictionary) payload's shared table is emitted at build time
 * in production; in development it is published to the runtime table store.
 * A global-registry payload always uses the runtime store (see
 * `global-translations.ts`).
 */
import fs from "node:fs";
import type { Keywords } from "@mongez/localization";
import { analyzePageTranslationUsage, type TranslationUsage } from "@warlock.js/core";
import {
  assetUrlFor,
  canonicalJson,
  EVERYTHING_USAGE,
  fullTableFor,
  localeCodesOf,
  pruneKeywords,
  sharedTranslationAssets,
  translationLatestUrl,
  usageFromRecord,
  type TranslationSourceEntries,
} from "../translations/delivery";
import {
  DEFAULT_SHARED_TRANSLATION_GROUPS,
  type HydrationTranslationAssets,
  type PageManifestTranslations,
} from "../translations/types";
import {
  pinTranslationTable,
  publishTranslationTable,
  translationTableUrl,
} from "./translation-tables";

/** What a page's payload gets for translations: its own pruned dictionary and the shared-table reference. */
export type DeliveredTranslations = {
  readonly keywords: Keywords;
  readonly assets: HydrationTranslationAssets | undefined;
};

/** How a scoped render decides what a page ships. Built once per route table. */
export type TranslationDelivery = {
  /** The groups shipped as shared tables. */
  readonly sharedGroups: readonly string[];
  /** What a page can reach, by the page identity the route resolver is called with. Unknown pages get everything. */
  usageFor(sourceFile: string): TranslationUsage;
  /** The shared table of one locale, or `undefined` for a locale with no sources. */
  assetFor(locale: string): HydrationTranslationAssets | undefined;
};

/**
 * Production: pin each locale's shared table in the table store, under the same
 * content hash the build emitted for it. The build file serves the hashed name;
 * the pinned copy answers the unhashed `<locale>.json` fallback in every process.
 */
export function pinSharedTranslationTables(
  sources: readonly TranslationSourceEntries[],
  sharedGroups: readonly string[] | undefined,
): void {
  for (const asset of sharedTranslationAssets(
    sources,
    sharedGroups ?? DEFAULT_SHARED_TRANSLATION_GROUPS,
  )) {
    pinTranslationTable(asset.locale, asset.body);
  }
}

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
      {
        url: assetUrlFor(asset.fileName),
        hash: asset.hash,
        groups: sharedGroups,
        latest: translationLatestUrl(asset.locale),
      },
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

/** A cached analysis, valid while every file it read keeps its modification time. */
type CachedUsage = {
  readonly usage: TranslationUsage;
  readonly files: readonly string[];
  readonly stamp: string;
};

function fileStamp(files: readonly string[]): string {
  return files.map((file) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1).join(",");
}

/**
 * A development usage analyzer. Each page is analyzed on demand and again when
 * any file it read has changed; the cache is keyed by the page's file.
 */
export function createDevelopmentUsageAnalyzer(
  appSrcRoot: string,
): (page: DevelopmentPageEntries) => TranslationUsage {
  const cache = new Map<string, CachedUsage>();

  return (page) => {
    const cached = cache.get(page.pageFile);
    if (cached !== undefined && cached.stamp === fileStamp(cached.files)) return cached.usage;

    const { usage, files } = analyzePageTranslationUsage({
      appSrcRoot,
      entries: page.entries,
      setupFiles: page.setupFiles,
    });
    cache.set(page.pageFile, { usage, files, stamp: fileStamp(files) });

    return usage;
  };
}

/**
 * Development: analyze each page's client graph on demand. The shared table is
 * the FULL table for the development build, published to the runtime store, so
 * the browser's missing-key detector can tell a pruned key from one that does
 * not exist.
 */
export function developmentTranslationDelivery(input: {
  readonly sources: readonly TranslationSourceEntries[];
  readonly appSrcRoot: string;
  readonly pages: readonly DevelopmentPageEntries[];
  readonly sharedGroups?: readonly string[];
  /** `false` makes every development page reach every key. */
  readonly prune?: boolean;
}): TranslationDelivery {
  const sharedGroups = input.sharedGroups ?? DEFAULT_SHARED_TRANSLATION_GROUPS;
  const pages = new Map(input.pages.map((page) => [page.pageFile, page]));
  const analyze = createDevelopmentUsageAnalyzer(input.appSrcRoot);
  const assets = new Map<string, HydrationTranslationAssets>();

  for (const locale of localeCodesOf(input.sources)) {
    const hash = publishTranslationTable(
      locale,
      canonicalJson(fullTableFor(input.sources, locale)),
      true,
    );
    assets.set(locale, {
      url: translationTableUrl(locale, hash),
      hash,
      groups: sharedGroups,
      development: true,
      latest: translationLatestUrl(locale),
    });
  }

  return {
    sharedGroups,
    usageFor(sourceFile) {
      const page = pages.get(sourceFile);
      if (page === undefined || input.prune === false) return EVERYTHING_USAGE;
      return analyze(page);
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
