import { Connector, ConnectorLifecyclePhase, ConnectorName } from "./types.mjs";

//#region ../../@warlock.js/core/src/connectors/base-connector.d.ts
/**
 * Base Connector Class
 * Provides common functionality for all connectors
 */
declare abstract class BaseConnector implements Connector {
  /**
   * Connector name
   */
  abstract readonly name: ConnectorName;
  /**
   * Initialization priority
   */
  abstract readonly priority: number;
  /**
   * Lifecycle phase. Defaults to `Early`; override to `Late` if the
   * connector consumes state user code registers at import time
   * (routes, socket listeners).
   */
  readonly lifecyclePhase: ConnectorLifecyclePhase;
  /**
   * Files that trigger restart when changed
   * Use relative paths
   */
  protected abstract readonly watchedFiles: string[];
  /**
   * Whether the connector is currently active
   */
  protected active: boolean;
  /**
   * Check if connector is active
   */
  isActive(): boolean;
  /**
   * Boot the connector
   */
  boot(): Promise<void>;
  /**
   * Initialize the connector
   */
  abstract start(): Promise<void>;
  /**
   * Restart the connector
   */
  restart(): Promise<void>;
  /**
   * Shutdown the connector
   */
  abstract shutdown(): Promise<void>;
  /**
   * Determine if connector should restart based on changed files
   */
  shouldRestart(changedFiles: string[]): boolean;
  /**
   * Check if a file is watched by this connector
   */
  protected isWatchedFile(file: string): boolean;
}
//#endregion
export { BaseConnector };
//# sourceMappingURL=base-connector.d.mts.map