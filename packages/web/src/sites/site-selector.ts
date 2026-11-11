import type { Request } from "@warlock.js/core";
import type { HostResolution, HostResolver, SitesConfig } from "./site-config.types";
import { assertResolvedSite, normalizeHost, validateSitesConfig } from "./validate-sites-config";

export type SiteSelectionInput = {
  rawHost: string;
  path: string;
  request: Request;
};

export type SiteSelection =
  | { kind: "site"; site: string; host: string; basePath: string; resolution?: HostResolution }
  | { kind: "not-found"; host: string };

/** Memoisation of `resolveHost` results by host. */
export type ResolveCacheOptions = {
  /** Seconds a result (including `null`) is reused. */
  ttl: number;
  /**
   * Most hosts remembered at once; the least recently used is dropped first.
   * Default 10,000.
   */
  maxEntries?: number;
};

export type SiteSelectorOptions = {
  sites: SitesConfig;
  resolveHost?: HostResolver;
  /** Memoises resolver results (including `null`) by host for `ttl` seconds. */
  resolveCache?: ResolveCacheOptions;
  unknownHost?: "not-found" | string;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
};

type CacheEntry = { value: HostResolution | null; expiresAt: number };

/** Default bound on remembered hosts: the host is client-supplied, so the memo must not grow forever. */
export const DEFAULT_RESOLVE_CACHE_MAX_ENTRIES = 10_000;

/** Longest valid DNS name; a longer `Host` can never be a tenant, so it never reaches the resolver. */
const MAX_HOST_LENGTH = 253;

/** True when `basePath` prefixes `path` on a segment boundary; an empty basePath matches all. */
function prefixes(basePath: string, path: string): boolean {
  return basePath === "" || path === basePath || path.startsWith(`${basePath}/`);
}

/** Pure host → site selection; does no routing and touches no server. */
export function createSiteSelector({
  sites,
  resolveHost,
  resolveCache,
  unknownHost,
  now = Date.now,
}: SiteSelectorOptions) {
  // Insertion order doubles as recency order: a hit is re-inserted at the end.
  const cache = new Map<string, CacheEntry>();
  const maxEntries = resolveCache?.maxEntries ?? DEFAULT_RESOLVE_CACHE_MAX_ENTRIES;

  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(
      `web.resolveCache.maxEntries must be a positive integer, received ${JSON.stringify(maxEntries)}.`,
    );
  }

  const remember = (host: string, entry: CacheEntry): void => {
    if (cache.size >= maxEntries) {
      const current = now();

      for (const [key, existing] of cache) {
        if (existing.expiresAt <= current) cache.delete(key);
      }
    }

    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next();

      if (oldest.done) break;

      cache.delete(oldest.value);
    }

    cache.set(host, entry);
  };

  const resolve = async (host: string, request: Request): Promise<HostResolution | null> => {
    if (!resolveHost) return null;

    if (host.length > MAX_HOST_LENGTH) return null;

    if (resolveCache) {
      const entry = cache.get(host);

      cache.delete(host);

      if (entry && entry.expiresAt > now()) {
        cache.set(host, entry);
        return entry.value;
      }
    }

    // A throw propagates and is never cached.
    const value = await resolveHost({ host, request });

    if (resolveCache) {
      remember(host, { value, expiresAt: now() + resolveCache.ttl * 1000 });
    }

    return value;
  };

  const fallback = (host: string): SiteSelection => {
    if (unknownHost && unknownHost !== "not-found" && unknownHost in sites) {
      return {
        kind: "site",
        site: unknownHost,
        host,
        basePath: sites[unknownHost].basePath ?? "",
      };
    }

    return { kind: "not-found", host };
  };

  const select = async ({ rawHost, path, request }: SiteSelectionInput): Promise<SiteSelection> => {
    const host = normalizeHost(rawHost);

    let listed = false;
    let best: { site: string; basePath: string } | undefined;

    for (const [key, site] of Object.entries(sites)) {
      if (!("hosts" in site) || !site.hosts.includes(host)) continue;

      listed = true;
      const basePath = site.basePath ?? "";

      if (prefixes(basePath, path) && (!best || basePath.length > best.basePath.length)) {
        best = { site: key, basePath };
      }
    }

    if (best) return { kind: "site", host, ...best };

    // Exact host always beats the resolver, even when no basePath matched.
    if (listed || !resolveHost) return fallback(host);

    const resolution = await resolve(host, request);

    if (!resolution) return fallback(host);

    assertResolvedSite(resolution, sites);

    const basePath = sites[resolution.site].basePath ?? "";

    if (!prefixes(basePath, path)) return fallback(host);

    return { kind: "site", site: resolution.site, host, basePath, resolution };
  };

  const forget = (host: string): void => {
    cache.delete(normalizeHost(host));
  };

  return { select, forget };
}

/** Complete boot check, including the resolver codes discovery skips; throws one Error. */
export function validateSitesAtBoot(config: {
  sites: SitesConfig;
  resolveHost?: HostResolver;
  unknownHost?: "not-found" | string;
}): void {
  const errors = validateSitesConfig(config);

  if (errors.length === 0) return;

  throw new Error(
    `Invalid web.sites configuration:\n${errors.map((error) => `- [${error.code}] ${error.message}`).join("\n")}`,
  );
}
