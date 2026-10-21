/**
 * Translation delivery for the global-registry mode: an app that registers its
 * copy with `extend()` / `groupedTranslations()` instead of route dictionaries
 * (the starter's default).
 *
 * Two modes share one payload shape:
 *
 * - **Production: snapshot.** The shared groups are copied once, when the web
 *   connector installs its routes at boot (after the server bundle has run its
 *   module-level registrations, before the server listens). That copy, its hash
 *   and the table that carries it are fixed for the life of the process. Every
 *   process booted from the same deployment computes the same copy, so the same
 *   hash, and a document from one process names a table every other process
 *   also holds. Registrations that happen later (a page's `register()` on its
 *   first request) are not added to the shared table. A key of a shared group
 *   that is used but not in the snapshot travels inline in that page's pruned
 *   payload, like any other used key.
 *
 * - **Development: live.** The shared groups are recomputed from the registry for
 *   every payload and republished when they changed, under `no-store`, so an
 *   edit shows at once.
 *
 * Each payload carries the page's pruned dictionary (the leaves its route can
 * reach that the table does not already hold) and the reference to the table.
 */
import { getKeywordsListOf, getTranslationsList, type Keywords } from "@mongez/localization";
import { type TranslationUsage } from "@warlock.js/core";
import {
  canonicalJson,
  EVERYTHING_USAGE,
  pruneKeywordsAgainst,
  translationLatestUrl,
  usageFromRecord,
} from "../translations/delivery";
import {
  DEFAULT_SHARED_TRANSLATION_GROUPS,
  type HydrationTranslationAssets,
  type PageManifestTranslations,
} from "../translations/types";
import type { DeliveredTranslations } from "./translation-delivery";
import {
  pinTranslationTable,
  publishTranslationTable,
  translationTableUrl,
} from "./translation-tables";

/** The global-registry delivery a render consults. */
export type GlobalTranslationDelivery = {
  readonly sharedGroups: readonly string[];
  /** The page's delivered translations for one locale, identified by its route name. */
  deliver(routeName: string, locale: string): DeliveredTranslations;
};

/** What both modes need. */
export type GlobalTranslationDeliveryInput = {
  readonly sharedGroups: readonly string[];
  /** `false` ships every non-shared key on every page. */
  readonly prune: boolean;
  /** The usage a route was analyzed to need, by its runtime route name. `undefined` for a route with none recorded. */
  usageFor(routeName: string): TranslationUsage | undefined;
  /** The registry's table for a locale. Defaults to `@mongez/localization`'s global list. */
  keywordsOf?(locale: string): Readonly<Keywords> | null;
};

/** The top-level groups of a table, as a new object. */
export function pickGroups(
  keywords: Readonly<Keywords>,
  groups: readonly string[],
): Record<string, unknown> {
  const wanted = new Set(groups);
  const picked: Record<string, unknown> = {};

  for (const [group, value] of Object.entries(keywords)) {
    if (wanted.has(group)) picked[group] = value;
  }

  return picked;
}

/** A detached deep copy, so a snapshot never shares objects with the mutable registry. */
function detachedCopy(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}

function usageOrEverything(
  input: GlobalTranslationDeliveryInput,
  routeName: string,
): TranslationUsage {
  if (!input.prune) return EVERYTHING_USAGE;

  return input.usageFor(routeName) ?? EVERYTHING_USAGE;
}

function keywordsOfLocale(
  input: GlobalTranslationDeliveryInput,
  locale: string,
): Readonly<Keywords> {
  return (input.keywordsOf ?? getKeywordsListOf)(locale) ?? {};
}

/** Development: the shared groups are read from the live registry for every payload. */
export function createLiveGlobalTranslationDelivery(
  input: GlobalTranslationDeliveryInput,
): GlobalTranslationDelivery {
  return {
    sharedGroups: input.sharedGroups,
    deliver(routeName, locale) {
      const keywords = keywordsOfLocale(input, locale);
      const shared = pickGroups(keywords, input.sharedGroups);
      // Development tables carry every group: the missing-key detector reads them.
      const hash = publishTranslationTable(locale, canonicalJson(keywords), true);

      return {
        keywords: pruneKeywordsAgainst(keywords, usageOrEverything(input, routeName), shared),
        assets: {
          url: translationTableUrl(locale, hash),
          hash,
          groups: input.sharedGroups,
          development: true,
          latest: translationLatestUrl(locale),
        },
      };
    },
  };
}

/** One locale's fixed shared table: its tree (for the pruning comparison) and its pinned hash. */
type Snapshot = { readonly tree: Record<string, unknown>; readonly hash: string };

/** Pin a table body and keep its tree: the same bytes name the same table in every process. */
function snapshotOf(locale: string, tree: Record<string, unknown>): Snapshot {
  return { tree, hash: pinTranslationTable(locale, canonicalJson(tree)) };
}

/**
 * Production: the shared groups are copied once, for the locales the registry
 * holds at boot, and never change. A locale the registry did not hold at boot
 * has an empty table, so it is the same in every process whatever its pages
 * register later.
 */
export function createSnapshotGlobalTranslationDelivery(
  input: GlobalTranslationDeliveryInput,
  localesAtBoot: readonly string[],
): GlobalTranslationDelivery {
  const snapshots = new Map<string, Snapshot>();

  for (const locale of localesAtBoot) {
    const tree = detachedCopy(pickGroups(keywordsOfLocale(input, locale), input.sharedGroups));
    snapshots.set(locale, snapshotOf(locale, tree));
  }

  return {
    sharedGroups: input.sharedGroups,
    deliver(routeName, locale) {
      const snapshot = snapshots.get(locale) ?? snapshotOf(locale, {});
      const keywords = keywordsOfLocale(input, locale);

      const assets: HydrationTranslationAssets = {
        url: translationTableUrl(locale, snapshot.hash),
        hash: snapshot.hash,
        groups: input.sharedGroups,
        latest: translationLatestUrl(locale),
      };

      return {
        keywords: pruneKeywordsAgainst(
          keywords,
          usageOrEverything(input, routeName),
          snapshot.tree,
        ),
        assets,
      };
    },
  };
}

/**
 * Route name to the source file its page was installed from, in production.
 * Filled as the production installer resolves each page's name, so the name a
 * payload carries (`bundle.route.name`) is looked up with the very name the
 * installer produced. No second derivation is involved.
 */
const routeSourceFiles = new Map<string, string>();

/** Record the source file the page installed under a route name. */
export function registerRouteSourceFile(routeName: string, sourceFile: string): void {
  routeSourceFiles.set(routeName, sourceFile);
}

/** The source file a route name was installed from, when known. */
export function routeSourceFileOf(routeName: string): string | undefined {
  return routeSourceFiles.get(routeName);
}

/** Forget every recorded route, before a fresh production install. */
export function resetRouteSourceFiles(): void {
  routeSourceFiles.clear();
}

/**
 * Production: the usage the build recorded per source file, looked up through
 * the route name the installer recorded.
 */
export function productionGlobalTranslationDeliveryInput(
  translations: PageManifestTranslations | undefined,
): GlobalTranslationDeliveryInput {
  const usage = translations?.usage ?? {};

  return {
    sharedGroups: translations?.sharedGroups ?? DEFAULT_SHARED_TRANSLATION_GROUPS,
    prune: translations?.prune ?? true,
    usageFor(routeName) {
      const sourceFile = routeSourceFileOf(routeName);
      if (sourceFile === undefined || !Object.hasOwn(usage, sourceFile)) return undefined;

      const record = usage[sourceFile];
      return record === undefined ? undefined : usageFromRecord(record);
    },
  };
}

let active: GlobalTranslationDelivery | undefined;

/**
 * Install the process's global-registry delivery. Production installs its
 * snapshot once at boot; development installs a live delivery per install. A
 * payload built with none installed carries the full registry, as it always did.
 */
export function installGlobalTranslationDelivery(
  delivery: GlobalTranslationDelivery | undefined,
): void {
  active = delivery;
}

/** The installed global-registry delivery, if any. */
export function globalTranslationDelivery(): GlobalTranslationDelivery | undefined {
  return active;
}

/** The locales the registry holds right now. Read once, at production boot. */
export function registeredLocales(): string[] {
  return Object.keys(getTranslationsList());
}
