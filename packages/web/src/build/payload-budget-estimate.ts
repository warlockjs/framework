/**
 * The part of `build.budgets.payload` that `warlock build` can measure.
 *
 * A document's inline payload has seven sections (see `../server/payload-budget`).
 * Two of them are fixed by the build alone:
 *
 * - `translations`: the page's pruned dictionary plus the pointer to the
 *   shared table, computed from the route-locale sources and the page's
 *   translation usage, for the largest locale. It is an upper bound: it prunes
 *   the whole dictionary, never only the keys the page's route registered.
 * - `routes`: the page's browser route table, from the named API routes the
 *   page's client code reaches. An upper bound: `web.namedApiRoutes` filters,
 *   site scoping and the guest rule only ever remove routes, and the build
 *   cannot read them.
 *
 * The rest (`page`, `layout`, `app` data, `session`, `other`) is produced by
 * loaders and requests, so it is not measured here and counts as zero. A page
 * over its limit with only these two sections is therefore over its limit at
 * runtime too, up to the upper-bound caveats above.
 */
import {
  fullTableFor,
  localeCodesOf,
  pruneKeywordsAgainst,
  sharedTableFor,
  usageFromRecord,
  EVERYTHING_USAGE,
  type TranslationSourceEntries,
} from "../translations/delivery";
import type { SerializedTranslationUsage } from "../translations/types";
import type { PagePayloadBudget } from "../server/page-manifest";
import { formatBytes, payloadBudgetFor, serializedBytes } from "../server/payload-budget";
import type { Keywords } from "@mongez/localization";

/** One page the estimate covers. */
export type PagePayloadInput = {
  readonly route: string;
  readonly path: string;
  /** App-root-relative page source, the key of its translation usage. */
  readonly source: string;
  readonly apiRouteNames: readonly string[];
};

/** A registered API route, as far as the route table needs it. */
export type EstimateApiRoute = {
  readonly name: string;
  readonly path: string;
  readonly method: string;
  readonly clientVisible?: false;
};

export type PagePayloadEstimate = {
  readonly route: string;
  readonly path: string;
  readonly source: string;
  /** The locale whose translations are the largest. */
  readonly locale: string | undefined;
  readonly sections: { readonly translations: number; readonly routes: number };
  readonly total: number;
};

export type PayloadEstimateSources = {
  readonly sources: readonly TranslationSourceEntries[];
  readonly usage: Readonly<Record<string, SerializedTranslationUsage>>;
  readonly sharedGroups: readonly string[];
  readonly prune: boolean;
};

/** Estimates the build-measurable sections of every page's inline payload. */
export function estimatePagePayloads(input: {
  readonly pages: readonly PagePayloadInput[];
  readonly translations: PayloadEstimateSources;
  readonly apiRoutes: readonly EstimateApiRoute[];
}): PagePayloadEstimate[] {
  const { sources, usage, sharedGroups, prune } = input.translations;
  const locales = localeCodesOf(sources);
  const fullTables = new Map(
    locales.map((locale) => [locale, fullTableFor(sources, locale)] as const),
  );
  const sharedTables = new Map(
    locales.map((locale) => [locale, sharedTableFor(sources, locale, sharedGroups)] as const),
  );
  const routesByName = new Map(
    input.apiRoutes
      .filter((route) => route.clientVisible !== false)
      .map((route) => [route.name, route]),
  );

  return input.pages.map((page) => {
    const record = usage[page.source];
    const pageUsage = !prune || record === undefined ? EVERYTHING_USAGE : usageFromRecord(record);

    let locale: string | undefined;
    let translations = 0;

    for (const code of locales) {
      const keywords = pruneKeywordsAgainst(
        fullTables.get(code) as Keywords,
        pageUsage,
        sharedTables.get(code) as Record<string, unknown>,
      );
      const bytes = serializedBytes(keywords);

      if (bytes > translations || locale === undefined) {
        translations = bytes;
        locale = code;
      }
    }

    const table: Record<string, { path: string; method: string }> = {};

    for (const name of page.apiRouteNames) {
      const route = routesByName.get(name);
      if (route !== undefined) table[name] = { path: route.path, method: route.method };
    }

    const routes = serializedBytes(table);

    return {
      route: page.route,
      path: page.path,
      source: page.source,
      locale,
      sections: { translations, routes },
      total: translations + routes,
    };
  });
}

/** A page whose build-measured payload is over its limit. */
export type PayloadBudgetOverage = PagePayloadEstimate & { readonly limit: number };

/** The pages over their limit, largest first. */
export function payloadBudgetOverages(
  estimates: readonly PagePayloadEstimate[],
  budget: PagePayloadBudget,
): PayloadBudgetOverage[] {
  return estimates
    .map((estimate) => ({ ...estimate, limit: payloadBudgetFor(budget, estimate.path).bytes }))
    .filter((estimate) => estimate.total > estimate.limit)
    .sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
}

/** One line per page over its limit, with the per-section breakdown. */
export function formatPayloadBudgetOverages(overages: readonly PayloadBudgetOverage[]): string {
  const lines = overages.map(
    (page) =>
      `  - ${page.path} (${page.source}): ${formatBytes(page.total)}, over its ${formatBytes(page.limit)} budget. ` +
      `translations ${formatBytes(page.sections.translations)}${page.locale === undefined ? "" : ` (${page.locale})`}, ` +
      `routes ${formatBytes(page.sections.routes)}`,
  );

  return (
    `${overages.length} page(s) exceed build.budgets.payload before any page data is added:\n` +
    `${lines.join("\n")}\n` +
    "Measured at build: translations and routes. Page, layout and app data, session and the rest are " +
    "loaded per request and are not counted here. Inline fewer translation keys (move them into the shared " +
    "groups or use fewer on this page), narrow web.namedApiRoutes, or raise build.budgets.payload for these routes."
  );
}
