/**
 * `sitemapConnector()` — the ONE thing `warlock.config.ts` imports from
 * `@warlock.js/sitemap`, and the connector `warlock add sitemap` registers.
 *
 * Deliberately a plain object with TYPE-ONLY imports from core, same
 * reasoning as `queueConnector()`/`webConnector()`: the config file that
 * constructs it must not drag core's runtime graph in at config-load time.
 * `@warlock.js/core` and `@warlock.js/web` are imported lazily, inside
 * `boot()`, where the app has already loaded both.
 */
import type { Connector, ConnectorLifecyclePhase, HttpContext } from "@warlock.js/core";
import { collectSitemapEntries } from "./collect-entries";
import { describeUnresolvedDynamicRoutes } from "./diagnostic";
import type { RoutablePage } from "./routable-page";
import type { SitemapConfig } from "./types";
import { resolveOrigin } from "./url";
import { buildSitemapXml } from "./xml";

/** Default path when `src/config/sitemap.ts` does not set one. */
export const DEFAULT_SITEMAP_PATH = "/sitemap.xml";

/**
 * Boots after the HTTP connector (`ConnectorPriority.HTTP` is `5`) and after
 * web (`5.5`, `web-connector-factory.ts`) — the route it registers has to
 * land on the same router web's pages already share, and `listRoutablePages`
 * only has a page graph to read once web has scanned it.
 */
export const SITEMAP_CONNECTOR_PRIORITY = 5.6;

export type SitemapConnectorOptions = {
  /** Supply the configuration directly instead of reading the `sitemap` config key (`src/config/sitemap.ts`). */
  config?: SitemapConfig;
};

/** Adapts one `listRoutablePages()` result into the package's own minimal `RoutablePage` shape. */
function toRoutablePage(page: {
  routeName: string;
  routePath: string;
  metadata?: unknown;
  sitemap?: unknown;
}): RoutablePage {
  const metadata = page.metadata;
  const robots =
    metadata !== null && typeof metadata === "object" && "robots" in metadata
      ? (metadata as { robots?: unknown }).robots
      : undefined;

  return {
    routeName: page.routeName,
    routePath: page.routePath,
    robots: typeof robots === "string" ? robots : undefined,
    sitemap: page.sitemap as RoutablePage["sitemap"],
  };
}

/**
 * Construct the sitemap connector.
 *
 * At `boot()`: reads the `sitemap` config (a no-op when `enabled` is not
 * `true`), resolves the public origin ONCE — failing loud via
 * {@link resolveOrigin}'s {@link MissingPublicUrlError} rather than falling
 * back to a request-derived host — and registers `GET <config.path>`.
 *
 * The route itself re-reads the page graph on every request via
 * `listRoutablePages()`, not once at boot: the registry can change under
 * `warlock dev`, and a sitemap that only reflects the app's shape at the
 * moment it booted is stale in exactly the way that made `2ede40cf`-class
 * defects expensive.
 *
 * @example
 * // warlock.config.ts
 * import { sitemapConnector } from "@warlock.js/sitemap";
 *
 * export default defineConfig({ connectors: [sitemapConnector()] });
 */
export function sitemapConnector(options: SitemapConnectorOptions = {}): Connector {
  let active = false;

  const connector: Connector = {
    name: "sitemap",
    priority: SITEMAP_CONNECTOR_PRIORITY,
    // Core's `ConnectorLifecyclePhase.Late`; spelled out so this module stays
    // free of a runtime import of core, same as `queueConnector()`.
    lifecyclePhase: "late" as ConnectorLifecyclePhase,
    isActive: () => active,
    async boot() {
      const { config, router } = await import("@warlock.js/core");

      const sitemapConfig = options.config ?? config.get<SitemapConfig | undefined>("sitemap");

      if (!sitemapConfig?.enabled) {
        return;
      }

      const appConfig = config.get<{ publicUrl?: string } | undefined>("app");
      const origin = resolveOrigin({ publicUrl: appConfig?.publicUrl, env: process.env });
      const path = sitemapConfig.path || DEFAULT_SITEMAP_PATH;

      router.get(path, async ({ response }: HttpContext) => {
        const { listRoutablePages } = await import("@warlock.js/web");
        const listed = await listRoutablePages({ appRoot: process.cwd() });
        const pages = listed.map(toRoutablePage);

        const { entries, unresolvedDynamicRoutes } = await collectSitemapEntries(pages, {
          defaults: sitemapConfig.defaults,
        });

        if (process.env.NODE_ENV !== "production") {
          const diagnostic = describeUnresolvedDynamicRoutes(unresolvedDynamicRoutes);
          if (diagnostic) console.warn(diagnostic);
        }

        const xml = buildSitemapXml(entries, origin);

        return response.setContentType("application/xml").send(xml);
      });

      active = true;
    },
    async start() {
      // Nothing to start: the route is registered at boot, once the HTTP
      // connector has built its server but before it listens — the same
      // window `queueConnector()`'s dashboard mount uses.
    },
    async restart() {
      await connector.shutdown();
      await connector.boot();
    },
    async shutdown() {
      active = false;
    },
    shouldRestart(changedFiles: string[]) {
      return changedFiles.some((file) => {
        const normalized = file.replace(/\\/g, "/");

        return normalized === "src/config/sitemap.ts" || normalized.endsWith("/src/config/sitemap.ts");
      });
    },
  };

  return connector;
}
