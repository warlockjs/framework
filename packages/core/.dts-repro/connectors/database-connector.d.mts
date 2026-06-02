import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/database-connector.d.ts
/**
 * Database Connector
 * Manages database connection lifecycle using @warlock.js/cascade
 */
declare class DatabaseConnector extends BaseConnector {
  readonly name = "database";
  readonly priority = ConnectorPriority.DATABASE;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Early;
  /**
   * Files that trigger database restart
   */
  protected readonly watchedFiles: string[];
  /**
   * Initialize database connection
   */
  start(): Promise<void>;
  /**
   * Shutdown database connection
   */
  shutdown(): Promise<void>;
}
//#endregion
export { DatabaseConnector };
//# sourceMappingURL=database-connector.d.mts.map