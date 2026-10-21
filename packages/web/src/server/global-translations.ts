/**
 * Translation delivery for the global-registry mode: an app that registers its
 * copy with `extend()` / `groupedTranslations()` instead of route dictionaries
 * (the starter's default).
 *
 * The registry grows as page modules register, and a page's own `register()`
 * runs just before its first render. So the shared table is not fixed at boot.
 * It is recomputed from the live registry for every payload, compared with the
 * table last published, and published under its new hash only when the bytes
 * changed. That is a string comparison per payload, and it means a registration
 * is never missed.
 *
 * Each payload then carries the page's pruned dictionary (the non-shared groups
 * its client code can reach, by the route's usage) and the reference to the
 * shared table. Pruning and the fallback rules are the same as in scoped mode.
 */
import { getKeywordsListOf, type Keywords } from "@mongez/localization";
import { type TranslationUsage } from "@warlock.js/core";
import {
  canonicalJson,
  EVERYTHING_USAGE,
  pruneKeywords,
  usageFromRecord,
} from "../translations/delivery";
import {
  DEFAULT_SHARED_TRANSLATION_GROUPS,
  type PageManifestTranslations,
} from "../translations/types";
import type { DeliveredTranslations } from "./translation-delivery";
import { publishTranslationTable, translationTableUrl } from "./translation-tables";

/** The global-registry delivery a render consults. */
export type GlobalTranslationDelivery = {
  readonly sharedGroups: readonly string[];
  /** The page's delivered translations for one locale, identified by its route name. */
  deliver(routeName: string, locale: string): DeliveredTranslations;
};

export type GlobalTranslationDeliveryInput = {
  readonly sharedGroups: readonly string[];
  /** `false` ships every non-shared key on every page. */
  readonly prune: boolean;
  /** Development tables carry every group (the missing-key detector reads them). */
  readonly development: boolean;
  /** The usage a route was analyzed to need. `undefined` for a route with none recorded. */
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

/** Build a global-mode delivery over a registry snapshot taken per payload. */
export function createGlobalTranslationDelivery(
  input: GlobalTranslationDeliveryInput,
): GlobalTranslationDelivery {
  const keywordsOf = input.keywordsOf ?? getKeywordsListOf;

  return {
    sharedGroups: input.sharedGroups,
    deliver(routeName, locale) {
      const keywords: Readonly<Keywords> = keywordsOf(locale) ?? {};
      const body = canonicalJson(
        input.development ? keywords : pickGroups(keywords, input.sharedGroups),
      );
      const hash = publishTranslationTable(locale, body, input.development);
      const usage =
        input.prune === false ? EVERYTHING_USAGE : (input.usageFor(routeName) ?? EVERYTHING_USAGE);

      return {
        keywords: pruneKeywords(keywords, usage, input.sharedGroups),
        assets: {
          url: translationTableUrl(locale, hash),
          hash,
          groups: input.sharedGroups,
          ...(input.development ? { development: true } : {}),
        },
      };
    },
  };
}

/** Production: the usage and options the build recorded in the barrel. */
export function productionGlobalTranslationDelivery(
  translations: PageManifestTranslations | undefined,
): GlobalTranslationDelivery {
  const routes = translations?.routes ?? {};

  return createGlobalTranslationDelivery({
    sharedGroups: translations?.sharedGroups ?? DEFAULT_SHARED_TRANSLATION_GROUPS,
    prune: translations?.prune ?? true,
    development: false,
    usageFor: (routeName) => {
      const record = Object.hasOwn(routes, routeName) ? routes[routeName] : undefined;
      return record === undefined ? undefined : usageFromRecord(record);
    },
  });
}

let active: GlobalTranslationDelivery | undefined;

/**
 * Install the process's global-registry delivery. The route table installs it
 * once per boot (production) or per development install; a payload built with
 * none installed carries the full registry, as it always did.
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
