/**
 * Build-time translation delivery: what each page can reach, and the hashed
 * shared tables the client loads once.
 *
 * Production has no source tree at run time, so everything the server needs to
 * prune a page is computed here and carried in the generated page barrel:
 * each page's usage (from its client module graph) and the shared-groups
 * setting. The shared tables are written into the client `assets` directory by
 * the build's emit step, under the same content hash the server recomputes from
 * the barrel's locale sources.
 */
import fs from "node:fs";
import { analyzePageTranslationUsage, type TranslationUsage } from "@warlock.js/core";
import { isDiscoveredRoutablePage, type DiscoveredPage } from "./discover-pages";
import { parseRouteLocaleFile } from "./parse-route-locales";
import {
  EVERYTHING_USAGE,
  serializeUsage,
  sharedTranslationAssets,
  type SharedTranslationAsset,
  type TranslationSourceEntries,
} from "../translations/delivery";
import {
  DEFAULT_SHARED_TRANSLATION_GROUPS,
  type PageManifestTranslations,
  type SerializedTranslationUsage,
} from "../translations/types";

/** Build-time translation options, as the web connector receives them. */
export type TranslationBuildOptions = {
  /** Top-level groups shipped once per locale as hashed assets. Default: `app` and `common`. */
  readonly sharedGroups?: readonly string[];
  /**
   * Inline only the keys each page can reach. `false` ships every non-shared key
   * on every page, the way payloads did before pruning. Default: `true`.
   */
  readonly prune?: boolean;
};

/** The effective translation settings, with every default applied. Development and production both use this. */
export function resolveTranslationOptions(options: TranslationBuildOptions | undefined): {
  readonly sharedGroups: readonly string[];
  readonly prune: boolean;
} {
  return {
    sharedGroups: resolveSharedGroups(options?.sharedGroups),
    prune: options?.prune !== false,
  };
}

export type TranslationBuildResult = {
  readonly manifest: PageManifestTranslations;
  readonly assets: readonly SharedTranslationAsset[];
};

export type TranslationBuildInput = {
  readonly srcRoot: string;
  readonly pages: readonly DiscoveredPage[];
  readonly localeFiles: readonly { readonly sourceFile: string; readonly webRoot: string }[];
  /** Turns an absolute path into the app-root-relative identity the barrel uses. */
  readonly relativeTo: (absolutePath: string) => string;
  readonly options?: TranslationBuildOptions;
};

const GROUP = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Shared groups are group names, so each must be one plain key segment. */
export function resolveSharedGroups(groups: readonly string[] | undefined): readonly string[] {
  const resolved = groups ?? DEFAULT_SHARED_TRANSLATION_GROUPS;

  for (const group of resolved) {
    if (!GROUP.test(group)) {
      throw new Error(
        `translations.sharedGroups entry ${JSON.stringify(group)} must be one translation group name, such as "app".`,
      );
    }
  }

  return [...new Set(resolved)];
}

/**
 * Parse every route-locale file for delivery. The build reads the same files
 * the barrel carries, so the server's recomputed hash matches the emitted one.
 */
function localeSources(
  localeFiles: TranslationBuildInput["localeFiles"],
): TranslationSourceEntries[] {
  return localeFiles.map((file) =>
    parseRouteLocaleFile({
      sourceFile: file.sourceFile,
      webRoot: file.webRoot,
      source: fs.readFileSync(file.sourceFile, "utf8"),
    }),
  );
}

/**
 * Compute the page usage manifest and the shared assets for one build.
 *
 * Each routable page is analyzed with the entries a render executes: the page,
 * its layouts, the application root and every error page. Error pages are
 * analyzed on their own, because they render in place of any page.
 */
export function buildTranslationManifest(input: TranslationBuildInput): TranslationBuildResult {
  const sharedGroups = resolveSharedGroups(input.options?.sharedGroups);
  const prune = input.options?.prune !== false;
  const sources = localeSources(input.localeFiles);
  const usage: Record<string, SerializedTranslationUsage> = {};

  const routable = input.pages.filter(isDiscoveredRoutablePage);
  const errorPages = input.pages.filter(
    (page) => page.type === "error" || page.type === "forbidden",
  );
  const errorEntries = errorPages.flatMap((page) => [
    page.pageFile,
    ...(page.appFile === undefined ? [] : [page.appFile]),
  ]);
  const errorSetups = errorPages.flatMap((page) => definedOf([page.setupFile, page.appSetupFile]));

  const record = (pageFile: string, analyzed: TranslationUsage): void => {
    usage[input.relativeTo(pageFile)] = serializeUsage(analyzed);
  };

  for (const page of routable) {
    const entries = [
      page.pageFile,
      ...page.layouts,
      ...(page.appFile === undefined ? [] : [page.appFile]),
      ...errorEntries,
    ];
    const setupFiles = [
      ...definedOf([page.setupFile, page.appSetupFile]),
      ...definedOf(page.layoutSetupFiles ?? []),
      ...errorSetups,
    ];

    const analyzed = prune
      ? analyzePageTranslationUsage({ appSrcRoot: input.srcRoot, entries, setupFiles }).usage
      : EVERYTHING_USAGE;

    record(page.pageFile, analyzed);
  }

  for (const page of errorPages) {
    record(
      page.pageFile,
      prune
        ? analyzePageTranslationUsage({
            appSrcRoot: input.srcRoot,
            // The error and forbidden pages share one analysis: the route
            // translations a failure binds come from whichever file the
            // request binds, and either can render for the same failure.
            entries: errorEntries,
            setupFiles: errorSetups,
          }).usage
        : EVERYTHING_USAGE,
    );
  }

  return {
    manifest: { sharedGroups, prune, usage },
    assets: sharedTranslationAssets(sources, sharedGroups),
  };
}

function definedOf(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined);
}
