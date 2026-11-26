/**
 * Reads `web.localeRouting` and folds in the app's locale configuration —
 * codes from `app.localeCodes`, the default from `app.localeCode` — into a
 * {@link LocaleRouting} value both installers publish and register against.
 *
 * There is deliberately no second locale list here (design note §Config):
 * `web.localeRouting` carries only the strategy, mirroring how
 * `../../sitemap/resolve-sitemap-config.ts` folds `app.localeCode(s)` into
 * its own resolved shape.
 */
import { config } from "@warlock.js/core";
import { type LocaleRouting, type LocaleRoutingStrategy } from "../../routing/locale-routing";

const STRATEGIES: readonly LocaleRoutingStrategy[] = ["none", "prefix", "prefix-except-default"];

/** Raised at boot when `web.localeRouting` is misconfigured. */
export class LocaleRoutingConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocaleRoutingConfigError";
  }
}

function isLocaleRoutingStrategy(value: unknown): value is LocaleRoutingStrategy {
  return typeof value === "string" && (STRATEGIES as readonly string[]).includes(value);
}

/** The strategy-only shape accepted from either `web.localeRouting` or one site. */
export type LocaleRoutingConfig = {
  readonly strategy?: LocaleRoutingStrategy;
  /** A site's own locale set, a subset of `app.localeCodes`. */
  readonly locales?: readonly string[];
  /** A site's own default locale. */
  readonly defaultLocale?: string;
};

/**
 * Resolves `web.localeRouting.strategy` (default `"none"`) against
 * `app.localeCodes` / `app.localeCode`, throwing a clear config error rather
 * than booting with a routing table nothing can satisfy.
 */
export function resolveLocaleRouting(
  localeRoutingConfig?: LocaleRoutingConfig,
  siteKey?: string,
): LocaleRouting {
  // An explicitly configured site (including `{}`) replaces the global
  // strategy; absence is the only case that inherits `web.localeRouting`.
  const effectiveConfig = localeRoutingConfig ?? config.get("web", {}).localeRouting;
  const strategy = effectiveConfig?.strategy ?? "none";

  if (!isLocaleRoutingStrategy(strategy)) {
    throw new LocaleRoutingConfigError(
      `web.localeRouting.strategy is "${String(strategy)}", which is not a valid strategy. ` +
        `Use one of: ${STRATEGIES.map((value) => `"${value}"`).join(", ")}.`,
    );
  }

  const appCodes = config.key<string[]>("app.localeCodes", []) ?? [];
  const appDefault = config.key<string>("app.localeCode", "") ?? "";
  const { codes, defaultLocale } = resolveSiteLocales(
    localeRoutingConfig,
    appCodes,
    appDefault,
    siteKey,
  );

  if (strategy !== "none") {
    if (codes.length < 1) {
      throw new LocaleRoutingConfigError(
        `web.localeRouting.strategy is "${strategy}" but app.localeCodes declares no locale ` +
          "codes. Configure at least one code in app.localeCodes before enabling locale routing.",
      );
    }

    if (!codes.includes(defaultLocale)) {
      throw new LocaleRoutingConfigError(
        `web.localeRouting.strategy is "${strategy}" but app.localeCode ("${defaultLocale}") is ` +
          `not one of app.localeCodes (${codes.map((code) => `"${code}"`).join(", ")}).`,
      );
    }
  }

  return { strategy, codes, defaultLocale };
}

/**
 * A site's `locales` / `defaultLocale` narrow the app's set. A site without
 * them gets the app's values unchanged. Raised at boot, naming the site, when
 * a code is not one of `app.localeCodes`.
 */
function resolveSiteLocales(
  siteConfig: LocaleRoutingConfig | undefined,
  appCodes: string[],
  appDefault: string,
  siteKey: string | undefined,
): { codes: readonly string[]; defaultLocale: string } {
  if (siteConfig?.locales === undefined && siteConfig?.defaultLocale === undefined) {
    return { codes: appCodes, defaultLocale: appDefault };
  }

  const owner = siteKey === undefined ? "web.localeRouting" : `web.sites.${siteKey}.localeRouting`;
  const listed = (values: readonly string[]) => values.map((code) => `"${code}"`).join(", ");
  const codes = siteConfig.locales === undefined ? appCodes : [...new Set(siteConfig.locales)];
  const unknown = codes.filter((code) => !appCodes.includes(code));

  if (codes.length < 1 || unknown.length > 0) {
    throw new LocaleRoutingConfigError(
      `${owner}.locales ${codes.length < 1 ? "is empty" : `lists ${listed(unknown)}, which app.localeCodes does not declare (${listed(appCodes)})`}. ` +
        "Use a non-empty subset of app.localeCodes.",
    );
  }

  const defaultLocale =
    siteConfig.defaultLocale ?? (codes.includes(appDefault) ? appDefault : (codes[0] as string));

  if (!codes.includes(defaultLocale)) {
    throw new LocaleRoutingConfigError(
      `${owner}.defaultLocale is "${defaultLocale}", which is not one of the site's locales (${listed(codes)}).`,
    );
  }

  return { codes, defaultLocale };
}

/**
 * The locale routing a client page registry is BUILT with — a fallback only:
 * the browser prefers the routing the server embeds in each document
 * (`../../entry/publish-document-locale-routing.ts`), resolved at boot with
 * the full config and validated there by {@link resolveLocaleRouting}.
 *
 * `warlock build` loads `web.ts`'s static shape but not `app.ts`, so a site's
 * own `localeRouting` reaches the build while `app.localeCodes` does not.
 * Validating that pair here would refuse every multi-site build with per-site
 * locale routing; the global `web.localeRouting` never hit this only because
 * it is absent at build time too. Without the app's locale config the fallback
 * is `none`, exactly what the global path has always produced.
 */
export function resolveClientLocaleRoutingFallback(
  localeRoutingConfig?: LocaleRoutingConfig,
  siteKey?: string,
): LocaleRouting {
  if (!Array.isArray(config.key<unknown>("app.localeCodes"))) {
    return { strategy: "none", codes: [], defaultLocale: "" };
  }

  return resolveLocaleRouting(localeRoutingConfig, siteKey);
}
