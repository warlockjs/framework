import type { Request } from "@warlock.js/core";
import { HYDRATION_SITE_QUERY } from "../vite/hydration-entries";
import { siteHydrationUrl } from "./hydration-client-url";
import { consumePageManifest } from "./page-manifest";

/**
 * Select the entry built for this request's site without changing the
 * single-site document. Production barrels record the emitted asset per site;
 * Vite development reuses the source entry and selects its virtual registry
 * through the same query the page-registry plugin consumes.
 */
export function hydrationClientUrlForRequest(
  url: string | undefined,
  request: Request,
): string | undefined {
  const site = request.site?.key;

  if (site === undefined || url === undefined) return url;

  const resolved = siteHydrationUrl(site);

  if (resolved !== undefined) return resolved;

  const emitted = consumePageManifest()?.sites?.[site]?.hydrationEntry;

  if (emitted !== undefined) return emitted.startsWith("/") ? emitted : `/${emitted}`;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${HYDRATION_SITE_QUERY}=${encodeURIComponent(site)}`;
}
