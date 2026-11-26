/**
 * Which locale codes a route dictionary or a page is held to. A site that
 * declares its own `localeRouting.locales` (`web.sites.<key>`) is held to those
 * codes; everything else, including the dictionaries above the site folders,
 * is held to `app.localeCodes`.
 */

/** Site key → the locales that site serves; only sites that declare their own appear. */
export type SiteLocaleCodes = Readonly<Record<string, readonly string[]>>;

const SITE_FOLDER = /(?:^|[\\/])\$sites[\\/]([^\\/]+)[\\/]/;

/** The site folder (`src/web/$sites/<key>/…`) a file lives in, if any. */
export function siteKeyOfFile(file: string): string | undefined {
  return SITE_FOLDER.exec(file)?.[1];
}

/** The codes a file's site is held to, or the app's codes when the site declares none. */
export function localeCodesForFile(
  file: string,
  appCodes: readonly string[] | undefined,
  siteLocaleCodes: SiteLocaleCodes | undefined,
): readonly string[] | undefined {
  const key = siteKeyOfFile(file);

  return key === undefined ? appCodes : (siteLocaleCodes?.[key] ?? appCodes);
}

/** The per-site code sets of a `web.sites` config, for the sites that set `localeRouting.locales`. */
export function siteLocaleCodesOf(
  sites:
    | Readonly<
        Record<string, { readonly localeRouting?: { readonly locales?: readonly string[] } }>
      >
    | undefined,
): SiteLocaleCodes | undefined {
  if (sites === undefined) return undefined;

  const entries = Object.entries(sites).flatMap(([key, site]) =>
    Array.isArray(site.localeRouting?.locales) && site.localeRouting.locales.length > 0
      ? [[key, [...site.localeRouting.locales]] as const]
      : [],
  );

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
