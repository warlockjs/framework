import type { Request } from "@warlock.js/core";
import type { LocaleRoutingStrategy } from "./routing/locale-routing";
import type { RobotsConfig } from "./sitemap/robots-config-types";
import type { WebSitemapConfig } from "./sitemap/sitemap-config-types";
import type { WebErrorReportingConfigurations } from "./server/error-reporting-config";
import type { SessionResolver } from "./session/session.types";
import type { NamedApiRoutesOption } from "./named-api-routes-config";
import type { HostResolver, SitesConfig } from "./sites/site-config.types";
import type { ResolveCacheOptions } from "./sites/site-selector";
import type { TlsAskAllow } from "./server/tls-ask";

/** Customises crawler detection for the fully resolved-document renderer. */
export type CrawlerDetectionOptions = {
  /** Replaces the built-in list; spread the defaults explicitly when extending it. */
  userAgents?: readonly RegExp[];
  /** Takes precedence over `userAgents` when provided. */
  detect?: (request: Request) => boolean;
};

/** Streaming SSR controls under the application's `web.streaming` configuration. */
export type WebStreamingConfigurations = {
  /** `false` disables crawler detection; omitted uses the built-in user-agent list. */
  crawlers?: false | CrawlerDetectionOptions;
  /** Milliseconds a single deferred value may take to settle. */
  deferTimeout?: number;
};

/** Configuration for page-action form state. */
export type WebFormsConfigurations = {
  /**
   * Extra field-name patterns (`*` wildcard, case-insensitive) never echoed in
   * failed action state. Added to the built-in list of secret-looking names
   * (`*password*`, `*token*`, `*secret*`, `*otp*`, `pin`, `cvv`, …), never
   * replacing it.
   */
  redactValues?: readonly string[];
  /** `false` echoes no submitted value after a failed action. Defaults to `true`. */
  echoValues?: boolean;
};

/** Application-owned configuration for the Web connector's server features. */
export type WebConfigurations = {
  /** Self-hosted faces, emitted CSS variables, preloads and metric-matched fallbacks. */
  fonts?: readonly import("./fonts/types").WebFont[];
  streaming?: WebStreamingConfigurations;
  forms?: WebFormsConfigurations;
  /**
   * Milliseconds for the non-deferred app → layout → page loader chain; `0` disables it.
   * Defaults to 15000 (90000 in development, where the first page also pays for compiling
   * its modules). The clock starts after any dev hot reload in progress has finished.
   */
  loaderTimeout?: number;
  /**
   * How the app, layout and page loaders start. `"serial"` (default) starts each
   * level after the one above it settled. `"parallel"` starts them together and
   * settles them in the same order: the first level that throws or ends the
   * request wins and the levels below are discarded (their loaders still ran).
   * Use it only when no loader reads what a loader above it set on the request.
   */
  loaders?: "serial" | "parallel";
  sitemap?: WebSitemapConfig;
  robots?: RobotsConfig;
  localeRouting?: { strategy?: LocaleRoutingStrategy };
  errors?: WebErrorReportingConfigurations;
  /** Resolves the signed-in user for pages, e.g. auth's `pageSession()`. */
  session?: SessionResolver;
  /**
   * Controls the browser route table each page embeds for `apiHref()` and
   * `useSubmitForm({ route })`: `false` embeds nothing, an allowlist or filter
   * narrows it, `{ privatePrefixes }` keeps path prefixes out for everyone.
   */
  namedApiRoutes?: NamedApiRoutesOption;
  /**
   * What the client build does when browser code imports a file of an
   * `app/<module>/` that is not browser-safe (`.client.*`, schema, types, or the
   * module's `web/` folder). `"warn"` (default) reports the import and
   * continues, `"error"` fails the build, `"off"` disables the rule. The default
   * becomes `"error"` in a later release.
   */
  moduleBoundary?: "error" | "warn" | "off";
  /** Opt-in multi-site mode: several sites (fixed hosts or resolver-driven) in one app. */
  sites?: SitesConfig;
  /**
   * Development only: extra hosts `warlock dev` answers besides `localhost`,
   * `*.localhost`, IP addresses and the fixed sites' hosts. An entry starting
   * with `.` also matches every subdomain (`".tenant.test"`). List the hosts
   * your dynamic sites use in development here. `true` disables the host
   * check, which lets any website you visit read your dev server through DNS
   * rebinding.
   */
  devAllowedHosts?: true | readonly string[];
  /** Maps a request host to a dynamic site; `null` means unknown host. */
  resolveHost?: HostResolver;
  /**
   * Opt-in memoisation of `resolveHost`, keyed by host ONLY; `ttl` in seconds,
   * `maxEntries` (default 10,000) bounds how many hosts are remembered.
   */
  resolveCache?: ResolveCacheOptions;
  /** What an unmatched host gets: a plain 404 (default) or the key of a fallback site. */
  unknownHost?: "not-found" | string;
  /** Path of the opt-in Caddy on-demand TLS `ask` endpoint, e.g. `/.well-known/warlock/domain`. */
  tlsAsk?: string;
  /**
   * Who may call the `tlsAsk` endpoint: `"any"` (default), `"loopback"`,
   * `"private"` (loopback and private-network addresses), or a list of exact
   * caller IP addresses. Other callers get 403.
   */
  tlsAskAllow?: TlsAskAllow;
};
