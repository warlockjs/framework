import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/herald-connector.d.ts
/**
 * Herald Connector
 * Manages message broker connection lifecycle using @warlock.js/herald
 */
declare class HeraldConnector extends BaseConnector {
  readonly name = "herald";
  readonly priority = ConnectorPriority.COMMUNICATOR;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Early;
  /**
   * Files that trigger herald restart
   */
  protected readonly watchedFiles: string[];
  /**
   * Initialize broker connection
   */
  start(): Promise<void>;
  /**
   * Shutdown broker connection
   */
  shutdown(): Promise<void>;
}
//#endregion
export { HeraldConnector };
//# sourceMappingURL=herald-connector.d.mts.map