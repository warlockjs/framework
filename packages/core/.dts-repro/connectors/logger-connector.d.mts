import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/logger-connector.d.ts
/**
 * Logger Connector
 * Manages logger lifecycle and ensures synchronous flushing on termination
 */
declare class LoggerConnector extends BaseConnector {
  readonly name = "logger";
  readonly priority = ConnectorPriority.LOGGER;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Early;
  /**
   * Files that trigger logger restart
   */
  protected readonly watchedFiles: string[];
  /**
   * Initialize logger configurations
   */
  start(): Promise<void>;
  /**
   * Shutdown logger and flush messages synchronously
   */
  shutdown(): Promise<void>;
}
//#endregion
export { LoggerConnector };
//# sourceMappingURL=logger-connector.d.mts.map