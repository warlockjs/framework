import type { Request } from "@warlock.js/core";
import type { SharedContext } from "../index";
import type { LocaleRoutingStrategy } from "../routing/locale-routing";
import type { RobotsConfig } from "../sitemap/robots-config-types";

/** What the host resolver receives: the normalised host and the full request. */
export type HostResolverInput = {
  host: string;
  request: Request;
};

/** A resolver's answer: which dynamic site owns the host, plus per-tenant data. */
export type HostResolution = {
  /** Key of a dynamic site declared in `web.sites`. */
  site: string;
  /** Partition key for caches and per-tenant state, e.g. the tenant id. */
  key: string;
  /** Whether the resolved host may be indexed by crawlers; defaults to not indexable. */
  indexable?: boolean;
  /** Merged into the request's `shared`, so the client reads it through `useShared()`. */
  shared?: Partial<SharedContext>;
  /** This host's `/robots.txt` policy, merged over the site's and over `web.robots`. */
  robots?: Partial<RobotsConfig>;
};

/** Returns the resolution, or `null` for a controlled 404. A throw is a 500. */
export type HostResolver = (
  input: HostResolverInput,
) => Promise<HostResolution | null> | HostResolution | null;

type SiteLocaleRouting = { strategy?: LocaleRoutingStrategy };

/** A site served on an explicit list of exact hostnames. */
export type FixedSiteConfig = {
  /** Exact lowercase hostnames without port; `www.` is an alias only when listed. */
  hosts: string[];
  /** Path prefix the whole site lives under on its hosts, e.g. `"/admin"`. */
  basePath?: string;
  /** Overrides the global `web.localeRouting` for this site. */
  localeRouting?: SiteLocaleRouting;
  /**
   * This site's `/robots.txt` policy, merged over `web.robots`: each key set
   * here replaces the global one (`groups` and `extra` are replaced whole,
   * not concatenated), and a site without `robots` gets the global policy.
   */
  robots?: Partial<RobotsConfig>;
};

/** A site whose hosts are claimed at runtime by `web.resolveHost`. */
export type DynamicSiteConfig = {
  dynamic: true;
  /** Path prefix the whole site lives under on its hosts, e.g. `"/admin"`. */
  basePath?: string;
  /** Overrides the global `web.localeRouting` for this site. */
  localeRouting?: SiteLocaleRouting;
  /**
   * This site's `/robots.txt` policy, merged over `web.robots`: each key set
   * here replaces the global one (`groups` and `extra` are replaced whole,
   * not concatenated), and a site without `robots` gets the global policy.
   */
  robots?: Partial<RobotsConfig>;
};

export type SiteConfig = FixedSiteConfig | DynamicSiteConfig;

/** `web.sites`, keyed by site key. */
export type SitesConfig = Record<string, SiteConfig>;
