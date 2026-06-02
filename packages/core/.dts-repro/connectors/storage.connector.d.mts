import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/storage.connector.d.ts
/**
 * Cache Connector
 * Manages cache engine connection lifecycle
 */
declare class StorageConnector extends BaseConnector {
  readonly name = "storage";
  readonly priority = ConnectorPriority.STORAGE;
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
export { StorageConnector };
//# sourceMappingURL=storage.connector.d.mts.map