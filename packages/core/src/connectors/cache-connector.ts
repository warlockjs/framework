import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import type { CacheDriver } from "@warlock.js/cache";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

/**
 * Cache Connector
 * Manages cache engine connection lifecycle
 */
export class CacheConnector extends BaseConnector {
  public readonly name = "cache";
  public readonly priority = ConnectorPriority.CACHE;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger cache restart
   */
  protected readonly watchedFiles = ["src/config/cache.ts", "src/config/cache.tsx"];

  /**
   * Initialize cache connection
   */
  public async start(): Promise<void> {
    const cacheConfig = config.get("cache");

    if (!cacheConfig) return;

    cache.setCacheConfigurations(cacheConfig);

    await cache.init();

    this.active = true;
  }

  /**
   * Shutdown cache connection
   *
   * Disconnects every loaded cache driver so external clients (e.g. a Redis
   * connection) are released instead of left dangling — mirroring the
   * database and herald connectors, which disconnect all registered
   * connections on shutdown.
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    // Disconnect every driver the manager loaded (not just the current one),
    // so secondary drivers selected via `cache.use("...")` also release their
    // connections.
    const drivers: CacheDriver<unknown, unknown>[] = Object.values(cache.loadedDrivers);

    for (const driver of drivers) {
      await driver.disconnect();
    }

    this.active = false;
  }
}
