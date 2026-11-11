/**
 * Discovery + exclusion + dynamic suppliers (contract Part 4, "What the
 * adapter owns" 1–3) — the one place that turns the application's page
 * graph into plain `@warlock.js/sitemap` entries. Reads pages through an
 * injected {@link SitemapPageSource}: an explicit `options.pageSource` wins,
 * otherwise the production source registered by `WebConnector.boot()`
 * (`./production-sitemap-page-source.ts`) is used when present, and dev
 * falls back to `listRoutablePages` (`../build/list-routable-pages`), which
 * `import()`s each page's SOURCE file — never reachable in a production
 * build, which is why production always registers its own source first.
 */
import { environment } from "@warlock.js/core";
import type { ProductionBundleGlobal } from "../server/production-bundle";
import type { DiscoverPagesOptions } from "../build/discover-pages";
import {
  expandLocaleEntries,
  localeInvariantEntry,
  type CollectedEntry,
  type LocaleMatrix,
} from "./expand-locale-entries";
import { getProductionSitemapPageSource } from "./production-sitemap-page-source";
import { resolveSitemapDeclaration } from "./resolve-layout-sitemap";
import {
  isSitemapPageEntriesDeclaration,
  type SitemapModelLike,
  type SitemapPageOptions,
  type SitemapPageSupplier,
  type SitemapPageUrl,
  type SitemapSupplierContext,
} from "./sitemap-page-export";
import type { SitemapPageSource } from "./sitemap-page-source";

export type CollectSitemapEntriesOptions = DiscoverPagesOptions & {
  readonly locales: LocaleMatrix;
  /** Limits collection to one site when serving a multi-site sitemap. */
  readonly site?: string;
  /** Injected page source — bypasses both the production registry and `listRoutablePages`. Primarily for tests. */
  readonly pageSource?: SitemapPageSource;
  /** Passed to every page's sitemap supplier; `{}` when omitted. */
  readonly supplierContext?: SitemapSupplierContext;
};

export type CollectedSitemapEntries = {
  readonly items: readonly CollectedEntry[];
  /** Model dependencies declared by page-owned entries suppliers, deduplicated by identity. */
  readonly models?: readonly SitemapModelLike[];
  /**
   * Every dynamic route pattern found with no supplier, plus every route a
   * supplier declared (contract: "a dynamic route without a supplier is
   * reported by name in the diagnostic ... never silently dropped").
   */
  readonly declaredRoutes: ReadonlySet<string>;
};

// A `[locale]` folder yields a literal `:locale` param that `expandLocaleEntries`
// substitutes per locale, so it alone does not make a page dynamic.
const isDynamicRoute = (routePath: string): boolean =>
  routePath.replace(/(^|\/):locale(?=\/|$)/g, "$1").includes(":");

type SupplierStep = {
  type: "supplier";
  supplier: SitemapPageSupplier;
  routePath: string | undefined;
  pageOptions: SitemapPageOptions | undefined;
};

/** Suppliers run at most this many at a time; their URLs are still added in page order. */
const SUPPLIER_CONCURRENCY = 4;

const warnedTenantSuppliers = new WeakSet<SitemapPageSupplier>();

async function resolveSupplier(
  supplier: SitemapPageSupplier,
  context: SitemapSupplierContext,
): Promise<SitemapPageUrl[]> {
  if (
    context.tenantKey !== undefined &&
    supplier.length === 0 &&
    environment() !== "production" &&
    !warnedTenantSuppliers.has(supplier)
  ) {
    warnedTenantSuppliers.add(supplier);
    console.warn(
      `[warlock:web] a sitemap supplier of dynamic site "${context.site ?? ""}" ignores its ` +
        "argument, so every tenant's sitemap lists the same URLs. Read `tenantKey` from the " +
        "supplier's argument and return only that tenant's URLs: `entries: ({ tenantKey }) => ...`.",
    );
  }

  return [...(await supplier(context))];
}

/**
 * Starts each task with at most `limit` running at once and returns one
 * promise per task, in task order. Every returned promise already has a
 * rejection handler attached, so a failure the caller never reaches (it
 * stopped at an earlier one) is not reported as unhandled.
 */
function runWithConcurrency<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T>[] {
  const settlers = tasks.map(() => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });

    promise.catch(() => undefined);

    return { promise, resolve, reject };
  });
  let next = 0;
  let running = 0;

  const launch = (): void => {
    while (running < limit && next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      const settler = settlers[index];

      if (task === undefined || settler === undefined) continue;

      running++;
      task()
        .then(settler.resolve, settler.reject)
        .finally(() => {
          running--;
          launch();
        });
    }
  };

  launch();

  return settlers.map((settler) => settler.promise);
}

function collectSupplierUrls(
  items: CollectedEntry[],
  urls: readonly SitemapPageUrl[],
  routePath: string | undefined,
  pageOptions: SitemapPageOptions | undefined,
  locales: LocaleMatrix,
): void {
  for (const url of urls) {
    if (pageOptions?.locales === false) items.push(localeInvariantEntry(url, routePath));
    else items.push(...expandLocaleEntries(url, routePath, locales));
  }
}

function toPageUrl(routePath: string, options: SitemapPageOptions): SitemapPageUrl {
  return {
    path: routePath,
    lastmod: options.lastmod,
    changefreq: options.changefreq,
    priority: options.priority,
    localePaths: options.localePaths,
  };
}

async function readSitemapPages(
  options: CollectSitemapEntriesOptions,
): Promise<Awaited<ReturnType<SitemapPageSource>>> {
  // The page walk is the development fallback: production reads the build's
  // page manifest. It reaches `@babel/parser`, so it is imported only here.
  const pageSource =
    options.pageSource ??
    getProductionSitemapPageSource() ??
    (async () => {
      // Development only: a production bundle always has the build's page
      // manifest, and this branch (with its Babel parser) is left out of it.
      if (!(globalThis as ProductionBundleGlobal).__WARLOCK_PRODUCTION_BUNDLE__) {
        const { listRoutablePages } = await import("../build/list-routable-pages");

        return listRoutablePages(options);
      }

      throw new Error("The production sitemap needs the page manifest from the build.");
    });

  return pageSource();
}

/**
 * Finds model dependencies without invoking page-owned entry suppliers. This
 * lets lifecycle wiring observe `invalidateOn` even when boot generation is
 * disabled or deferred.
 */
export async function collectSitemapModelDependencies(
  options: CollectSitemapEntriesOptions,
): Promise<readonly SitemapModelLike[]> {
  const models = new Set<SitemapModelLike>();

  for (const page of await readSitemapPages(options)) {
    const sitemapExport = resolveSitemapDeclaration(page.sitemap, page.layoutSitemaps ?? []);
    if (!isSitemapPageEntriesDeclaration(sitemapExport)) continue;

    for (const model of sitemapExport.invalidateOn ?? []) models.add(model);
  }

  return [...models];
}

export async function collectSitemapEntries(
  options: CollectSitemapEntriesOptions,
): Promise<CollectedSitemapEntries> {
  const pages = await readSitemapPages(options);
  const items: CollectedEntry[] = [];
  const declaredRoutes = new Set<string>();
  const models = new Set<SitemapModelLike>();
  const supplierContext = options.supplierContext ?? {};
  // Page order decides output order. Each step either adds its entries
  // directly or adds the URLs of one supplier, whose call is started below
  // with bounded concurrency and awaited here in order.
  const steps: Array<{ type: "entries"; add: () => void } | SupplierStep> = [];

  for (const page of pages) {
    if (options.site !== undefined && page.site !== options.site) continue;
    // THE one call site for the layout/page precedence rule. Both page sources
    // hand over raw declarations — the page's own and each layout's on its
    // path — and the rule is applied here, once, so dev and production cannot
    // disagree about a sitemap without the disagreement being this line
    // (canon `b8e6ede3`). See `contracts/layout-sitemap-and-robots-5.17.md`.
    const sitemapExport = resolveSitemapDeclaration(page.sitemap, page.layoutSitemaps ?? []);

    // Opt-out — never emitted, and never declared, either: an author who
    // wrote `false` asked for silence, not a zero-count row.
    if (sitemapExport === false) continue;

    if (isDynamicRoute(page.routePath)) {
      declaredRoutes.add(page.routePath);

      // A dynamic pattern is not a URL. Only a supplier FUNCTION can name the
      // concrete paths behind it; anything else (no export, or a static
      // options object, which has no path to apply to) contributes nothing
      // and is reported via `declaredRoutes` instead of silently dropped.
      const supplier =
        typeof sitemapExport === "function"
          ? sitemapExport
          : isSitemapPageEntriesDeclaration(sitemapExport)
            ? sitemapExport.entries
            : undefined;
      if (!supplier) continue;

      if (isSitemapPageEntriesDeclaration(sitemapExport)) {
        for (const model of sitemapExport.invalidateOn ?? []) models.add(model);
      }

      steps.push({
        type: "supplier",
        supplier,
        routePath: page.routePath,
        pageOptions: isSitemapPageEntriesDeclaration(sitemapExport) ? sitemapExport : undefined,
      });

      continue;
    }

    // Static page.
    const supplier =
      typeof sitemapExport === "function"
        ? sitemapExport
        : isSitemapPageEntriesDeclaration(sitemapExport)
          ? sitemapExport.entries
          : undefined;
    if (supplier) {
      if (isSitemapPageEntriesDeclaration(sitemapExport)) {
        for (const model of sitemapExport.invalidateOn ?? []) models.add(model);
      }

      steps.push({
        type: "supplier",
        supplier,
        routePath: undefined,
        pageOptions: isSitemapPageEntriesDeclaration(sitemapExport) ? sitemapExport : undefined,
      });

      continue;
    }

    const pageOptions: SitemapPageOptions =
      typeof sitemapExport === "object" && sitemapExport !== null ? sitemapExport : {};
    const url = toPageUrl(page.routePath, pageOptions);

    if (pageOptions.locales === false) {
      steps.push({ type: "entries", add: () => items.push(localeInvariantEntry(url, undefined)) });
      continue;
    }

    steps.push({
      type: "entries",
      add: () => items.push(...expandLocaleEntries(url, undefined, options.locales)),
    });
  }

  const supplierSteps = steps.filter((step): step is SupplierStep => step.type === "supplier");
  const supplied = runWithConcurrency(
    supplierSteps.map((step) => () => resolveSupplier(step.supplier, supplierContext)),
    SUPPLIER_CONCURRENCY,
  );
  let suppliedIndex = 0;

  for (const step of steps) {
    if (step.type === "entries") {
      step.add();
      continue;
    }

    const urls = supplied[suppliedIndex++];

    if (urls === undefined) continue;

    collectSupplierUrls(items, await urls, step.routePath, step.pageOptions, options.locales);
  }

  return models.size === 0
    ? { items, declaredRoutes }
    : { items, models: [...models], declaredRoutes };
}
