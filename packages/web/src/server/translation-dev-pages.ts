import {
  isFile,
  isErrorPageFile,
  isForbiddenPageFile,
  layoutChainFor,
} from "../build/discover-pages";
import { pageSetupFileFor } from "../build/page-setup-file";
import type { TranslationUsage } from "@warlock.js/core";
import {
  createDevelopmentUsageAnalyzer,
  type DevelopmentPageEntries,
} from "./translation-delivery";

/** The setup companion of a module, when it exists on disk. */
function existingSetup(file: string | undefined): string[] {
  if (file === undefined) return [];
  const setup = pageSetupFileFor(file);
  return setup !== undefined && isFile(setup) ? [setup] : [];
}

/**
 * The development analysis inputs of every page the dev server registers: what
 * each page's client graph starts from, and which setup files declare keys.
 *
 * It mirrors what the production build computes (`build/translation-manifest.ts`):
 * a page is analyzed with its layouts, the application root and every error page,
 * and error pages are analyzed with the root. Keeping the two in step is what
 * makes a page's dev payload and its production payload carry the same keys.
 */
export function developmentTranslationPages(input: {
  readonly pages: readonly { readonly pageFile: string; readonly webRoot: string }[];
  readonly appFile: string | undefined;
}): DevelopmentPageEntries[] {
  const { appFile } = input;
  const rootEntries = appFile === undefined ? [] : [appFile];
  const rootSetups = existingSetup(appFile);
  const isSpecialPage = (file: string) => isErrorPageFile(file) || isForbiddenPageFile(file);
  const errorPages = input.pages.filter((page) => isSpecialPage(page.pageFile));
  const errorEntries = errorPages.flatMap((page) => [page.pageFile, ...rootEntries]);
  const errorSetups = errorPages.flatMap((page) => existingSetup(page.pageFile));

  return input.pages.map((page) => {
    if (isSpecialPage(page.pageFile)) {
      return {
        pageFile: page.pageFile,
        // Error and forbidden pages share one analysis, like the build.
        entries: errorEntries,
        setupFiles: [...errorSetups, ...rootSetups],
      };
    }

    const layouts = layoutChainFor(page.pageFile, page.webRoot);

    return {
      pageFile: page.pageFile,
      entries: [page.pageFile, ...layouts, ...rootEntries, ...errorEntries],
      setupFiles: [
        ...existingSetup(page.pageFile),
        ...layouts.flatMap(existingSetup),
        ...rootSetups,
        ...errorSetups,
      ],
    };
  });
}

/** Development usage by route name, for the global-registry mode, whose payloads are built from the matched route. */
let routeEntries: Map<string, DevelopmentPageEntries> | undefined;
let analyzeRoute: ((page: DevelopmentPageEntries) => TranslationUsage) | undefined;

/** Start a fresh route-usage table for one development install. */
export function beginDevelopmentRouteUsage(appSrcRoot: string): void {
  routeEntries = new Map<string, DevelopmentPageEntries>();
  analyzeRoute = createDevelopmentUsageAnalyzer(appSrcRoot);
}

/** Record the analysis inputs of the page a route name resolved to. */
export function registerDevelopmentRouteUsage(
  routeName: string,
  page: DevelopmentPageEntries,
): void {
  routeEntries?.set(routeName, page);
}

/** The usage of the page a route name resolved to, or `undefined` when no page was recorded for it. */
export function developmentRouteUsageFor(routeName: string): TranslationUsage | undefined {
  const page = routeEntries?.get(routeName);
  return page === undefined || analyzeRoute === undefined ? undefined : analyzeRoute(page);
}
