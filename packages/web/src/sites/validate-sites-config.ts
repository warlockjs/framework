import type {
  HostResolution,
  HostResolver,
  SiteLocaleRouting,
  SitesConfig,
} from "./site-config.types";

export type SiteConfigErrorCode =
  | "SITE_KEY_INVALID"
  | "SITE_PAGES_REMOVED"
  | "SITE_HOSTS_AND_DYNAMIC"
  | "SITE_NO_HOSTS_OR_DYNAMIC"
  | "SITE_HOST_INVALID"
  | "SITE_HOST_OVERLAP"
  | "SITE_BASEPATH_INVALID"
  | "SITE_LOCALES_INVALID"
  | "DYNAMIC_SITE_WITHOUT_RESOLVER"
  | "RESOLVER_WITHOUT_DYNAMIC_SITE"
  | "UNKNOWN_HOST_SITE_MISSING";

export type SiteConfigError = {
  code: SiteConfigErrorCode;
  site?: string;
  message: string;
};

const SITE_KEY = /^[a-z][a-zA-Z0-9-]*$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Site-selection host form: lowercase, port and trailing dot removed.
 * `www.` is kept on purpose; it is an alias only when a site lists it.
 */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** What is wrong with one site's `localeRouting.locales` / `defaultLocale`, as readable messages. */
function siteLocaleProblems(
  key: string,
  routing: SiteLocaleRouting | undefined,
  appCodes: readonly string[] | undefined,
): string[] {
  if (routing === undefined) return [];

  const problems: string[] = [];
  const { locales, defaultLocale } = routing;

  if (locales !== undefined) {
    if (
      !Array.isArray(locales) ||
      locales.length === 0 ||
      locales.some((code) => typeof code !== "string")
    ) {
      problems.push(
        `Site "${key}" has invalid localeRouting.locales; it must be a non-empty array of locale codes taken from app.localeCodes.`,
      );
    } else if (appCodes !== undefined) {
      const unknown = locales.filter((code) => !appCodes.includes(code));

      if (unknown.length > 0) {
        problems.push(
          `Site "${key}" lists localeRouting.locales ${unknown.map((code) => `"${code}"`).join(", ")} that app.localeCodes does not declare (${appCodes.map((code) => `"${code}"`).join(", ")}). Add the code to app.localeCodes or remove it from the site.`,
        );
      }
    }
  }

  if (defaultLocale !== undefined) {
    const allowed = Array.isArray(locales) && locales.length > 0 ? locales : appCodes;

    if (typeof defaultLocale !== "string") {
      problems.push(
        `Site "${key}" has invalid localeRouting.defaultLocale; it must be a locale code.`,
      );
    } else if (allowed !== undefined && !allowed.includes(defaultLocale)) {
      problems.push(
        `Site "${key}" sets localeRouting.defaultLocale "${defaultLocale}", which is not one of its locales (${allowed.map((code) => `"${code}"`).join(", ")}).`,
      );
    }
  }

  return problems;
}

/** Pure structural validation of `web.sites`; never throws and touches no filesystem. */
export function validateSitesConfig({
  sites,
  resolveHost,
  unknownHost,
  localeCodes,
}: {
  sites: SitesConfig;
  resolveHost?: HostResolver;
  unknownHost?: "not-found" | string;
  /** `app.localeCodes`; when given, a site's `localeRouting.locales` must be a subset of it. */
  localeCodes?: readonly string[];
}): SiteConfigError[] {
  const errors: SiteConfigError[] = [];
  const hostOwner = new Map<string, string>();
  const dynamicSites: string[] = [];

  for (const [key, site] of Object.entries(sites)) {
    if (!SITE_KEY.test(key)) {
      errors.push({
        code: "SITE_KEY_INVALID",
        site: key,
        message: `Site key "${key}" is invalid; it must match ${SITE_KEY}.`,
      });
    }

    if (Object.hasOwn(site, "pages")) {
      errors.push({
        code: "SITE_PAGES_REMOVED",
        site: key,
        message: `web.sites.${key}.pages was removed in 5.23.1: move src/web/${String((site as { pages?: unknown }).pages)} to src/web/$sites/${key} and delete "pages".`,
      });
    }

    const hosts = (site as { hosts?: unknown }).hosts;
    const hasHosts = hosts !== undefined;
    const hasResolve = (site as { dynamic?: unknown }).dynamic === true;
    if (hasResolve) dynamicSites.push(key);

    if (hasHosts && hasResolve) {
      errors.push({
        code: "SITE_HOSTS_AND_DYNAMIC",
        site: key,
        message: `Site "${key}" sets both hosts and dynamic; use one or the other.`,
      });
    } else if (!hasHosts && !hasResolve) {
      errors.push({
        code: "SITE_NO_HOSTS_OR_DYNAMIC",
        site: key,
        message: `Site "${key}" needs either hosts or dynamic: true.`,
      });
    }

    const basePath = site.basePath;
    if (
      basePath !== undefined &&
      (typeof basePath !== "string" ||
        basePath === "/" ||
        !basePath.startsWith("/") ||
        basePath.endsWith("/"))
    ) {
      errors.push({
        code: "SITE_BASEPATH_INVALID",
        site: key,
        message: `Site "${key}" has invalid basePath "${String(basePath)}"; it must start with "/", must not end with "/", and must not be "/".`,
      });
    }

    for (const message of siteLocaleProblems(key, site.localeRouting, localeCodes)) {
      errors.push({ code: "SITE_LOCALES_INVALID", site: key, message });
    }

    if (hasHosts && !hasResolve) {
      const list: unknown[] = Array.isArray(hosts) ? hosts : [];
      const prefix = typeof basePath === "string" ? basePath : "";

      for (const host of list) {
        if (typeof host !== "string" || !HOSTNAME.test(host)) {
          errors.push({
            code: "SITE_HOST_INVALID",
            site: key,
            message: `Site "${key}" has invalid host "${String(host)}"; use a lowercase hostname without scheme, port, path or wildcard.`,
          });
          continue;
        }

        const identity = `${host}${prefix}`;
        const owner = hostOwner.get(identity);
        if (owner !== undefined && owner !== key) {
          errors.push({
            code: "SITE_HOST_OVERLAP",
            site: key,
            message: `Sites "${owner}" and "${key}" both serve host "${host}" at basePath "${prefix || "/"}".`,
          });
        } else {
          hostOwner.set(identity, key);
        }
      }

      if (!Array.isArray(hosts)) {
        errors.push({
          code: "SITE_HOST_INVALID",
          site: key,
          message: `Site "${key}" has invalid hosts "${String(hosts)}"; it must be an array of hostnames.`,
        });
      }
    }
  }

  if (dynamicSites.length > 0 && !resolveHost) {
    errors.push({
      code: "DYNAMIC_SITE_WITHOUT_RESOLVER",
      site: dynamicSites[0],
      message: `Dynamic site(s) ${dynamicSites.map((name) => `"${name}"`).join(", ")} require web.resolveHost, which is not set.`,
    });
  }

  if (resolveHost && dynamicSites.length === 0) {
    errors.push({
      code: "RESOLVER_WITHOUT_DYNAMIC_SITE",
      message: "web.resolveHost is set but no site in web.sites has dynamic: true.",
    });
  }

  if (unknownHost !== undefined && unknownHost !== "not-found" && !(unknownHost in sites)) {
    errors.push({
      code: "UNKNOWN_HOST_SITE_MISSING",
      message: `unknownHost names site "${unknownHost}", which is not defined in web.sites.`,
    });
  }

  return errors;
}

/** Runtime guard for S2: the resolver may only name a declared dynamic site. */
export function assertResolvedSite(resolution: HostResolution, sites: SitesConfig): void {
  const site = sites[resolution.site] as { dynamic?: unknown } | undefined;

  if (!site || site.dynamic !== true) {
    throw new Error(
      `web.resolveHost returned site "${resolution.site}", which is not a dynamic site in web.sites.`,
    );
  }
}
