export type AppConfigurations = {
  /**
   * App name
   */
  appName?: string;
  /**
   * Default locale code
   *
   * @default en
   */
  localeCode?: string;
  /**
   * Application base URL
   *
   * @default localhost:
   */
  baseUrl?: string;
  /**
   * The application's public origin — the absolute URL other consumers (the
   * sitemap route, canonical links, OG tags, absolute URLs in mail) build
   * links against. Optional in general; falls back to the `PUBLIC_APP_URL`
   * env var (see {@link getPublicUrl}). A consumer that requires it (e.g. the
   * sitemap route) fails boot loudly, naming both, when neither is set — it
   * never falls back to a request-derived origin.
   */
  publicUrl?: string;
  /**
   * Application timezone
   */
  timezone?: string;
  /**
   * Locale Codes list
   */
  localeCodes?: string[];
};
