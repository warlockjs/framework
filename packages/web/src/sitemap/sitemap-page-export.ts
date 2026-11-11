/**
 * The page-level `export const sitemap = ...` contract (Part 4). Read
 * dynamically off `ListedRoutablePage.sitemap` by `collect-sitemap-entries.ts` —
 * `listRoutablePages` types this field as `unknown` deliberately (it names no
 * sitemap concept), so this module is the one place its shape is trusted.
 */
import type { ChangeFreq } from "@warlock.js/sitemap";
import type { SitemapPageUrl } from "./expand-locale-entries";
import type { SharedContext } from "../index";

export type { SitemapPageUrl };

/**
 * Static per-page options. `SitemapPageOptions` is named but not spelled out
 * in the v5.16 contract text — filled in here per the card's description
 * ("static options (priority/changefreq/lastmod), `locales: false` for
 * locale-invariant pages"). `localePaths` covers the same divergent-slug case
 * `SitemapPageUrl.localePaths` does, for a static page that never returns a
 * supplier function.
 */
export type SitemapPageOptions = {
  readonly priority?: number;
  readonly changefreq?: ChangeFreq;
  readonly lastmod?: string | Date;
  /** `false` opts this page out of locale expansion entirely — contract 5(a). */
  readonly locales?: false;
  readonly localePaths?: Readonly<Record<string, string>>;
};

/** The minimal Cascade-model surface sitemap invalidation will subscribe to. */
export type SitemapModelLike = {
  readonly events: () => {
    readonly on: (
      event: "saved" | "deleted",
      listener: (...arguments_: never[]) => void | Promise<void>,
    ) => () => void;
  };
};

/**
 * What a sitemap supplier receives. Single-site generation passes an empty
 * object. A multi-site sitemap names its site, and a dynamic (tenant) site
 * also names the tenant it is built for: a supplier for a dynamic site must
 * scope its rows by `tenantKey`, or every tenant's sitemap lists every
 * tenant's URLs.
 */
export type SitemapSupplierContext = {
  /** The site key, in multi-site mode. */
  readonly site?: string;
  /** The tenant's `key` from `web.resolveHost`, when building a dynamic site's sitemap. */
  readonly tenantKey?: string;
  /** The tenant's `shared` from `web.resolveHost`, when it returned one. */
  readonly shared?: Readonly<Partial<SharedContext>>;
};

export type SitemapPageSupplier = (
  context: SitemapSupplierContext,
) => Promise<Iterable<SitemapPageUrl>> | Iterable<SitemapPageUrl>;

/** A page-owned URL supplier with optional model dependencies for later invalidation wiring. */
export type SitemapPageEntriesDeclaration = SitemapPageOptions & {
  readonly entries: SitemapPageSupplier;
  readonly invalidateOn?: readonly SitemapModelLike[];
};

export function isSitemapPageEntriesDeclaration(
  value: SitemapPageExport | undefined,
): value is SitemapPageEntriesDeclaration {
  return typeof value === "object" && value !== null && "entries" in value;
}

/** A page opts out, declares static options, or supplies its URLs in either supported form. */
export type SitemapPageExport =
  | false
  | SitemapPageOptions
  | SitemapPageSupplier
  | SitemapPageEntriesDeclaration;
