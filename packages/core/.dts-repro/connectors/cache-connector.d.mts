import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/cache-connector.d.ts
/**
 * Cache Connector
 * Manages cache engine connection lifecycle
 */
declare class CacheConnector extends BaseConnector {
  readonly name = "cache";
  readonly priority = ConnectorPriority.CACHE;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Early;
  /**
   * Files that trigger cache restart
   */
  protected readonly watchedFiles: string[];
  /**
   * Initialize cache connection
   */
  start(): Promise<void>;
  /**
   * Shutdown cache connection
   */
  shutdown(): Promise<void>;
}
//#endregion
export { CacheConnector };
//# sourceMappingURL=cache-connector.d.mts.map