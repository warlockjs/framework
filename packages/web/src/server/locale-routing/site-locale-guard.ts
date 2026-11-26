/**
 * The two pieces of locale routing both page installers share: which codes a
 * not-found page may pin from the URL, and the per-request limit a site puts
 * on the locales it serves.
 */
import type { LocaleRouting } from "../../routing/locale-routing";
import type { PageRouteHandler } from "../create-page-route-handler";

/**
 * The locale codes the not-found page matches a leading URL segment against,
 * so `/ar/missing` renders in `ar`. `undefined` under `"none"`: no segment of
 * the URL carries a locale. Dev and production both call this, so the two
 * cannot disagree; under multi-site, `routing` is the site's own.
 */
export function notFoundLocaleCodes(routing: LocaleRouting): readonly string[] | undefined {
  return routing.strategy === "none" ? undefined : routing.codes;
}

/** True when the site declares its own `locales` or `defaultLocale`. */
export function siteDeclaresLocales(
  siteLocaleRouting: { readonly locales?: unknown; readonly defaultLocale?: unknown } | undefined,
): boolean {
  return siteLocaleRouting?.locales !== undefined || siteLocaleRouting?.defaultLocale !== undefined;
}

/**
 * Wraps a handler so a request whose locale (from `?locale=`, the locale
 * cookie or the `locale` header) is outside the site's set is answered in the
 * site's default locale instead. A no-op wrapper is never created: a site
 * without its own locales gets the handler back unchanged.
 */
export function restrictToSiteLocales(
  handler: PageRouteHandler,
  routing: LocaleRouting,
  siteLocaleRouting: { readonly locales?: unknown; readonly defaultLocale?: unknown } | undefined,
): PageRouteHandler {
  if (!siteDeclaresLocales(siteLocaleRouting)) return handler;

  return (context) => {
    const { request } = context;

    if (!routing.codes.includes(request.locale)) request.locale = routing.defaultLocale;

    return handler(context);
  };
}
