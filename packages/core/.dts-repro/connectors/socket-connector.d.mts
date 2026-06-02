import { ConnectorLifecyclePhase, ConnectorName, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import { Server } from "socket.io";

//#region ../../@warlock.js/core/src/connectors/socket-connector.d.ts
/**
 * Socket Connector
 * Manages Socket server (Socket.IO) lifecycle
 */
declare class SocketConnector extends BaseConnector {
  readonly name: ConnectorName;
  readonly priority = ConnectorPriority.SOCKET;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Late;
  /**
   * Files that trigger Socket server restart
   * Note: routes.ts changes will be handled by HMR with wildcard routing
   * Connectors receive config file paths directly (not .env) thanks to layer-executor
   */
  protected readonly watchedFiles: string[];
  protected socket?: Server;
  /**
   * Boot the connector
   */
  boot(): Promise<void>;
  /**
   * Initialize Socket server
   */
  start(): Promise<void>;
  /**
   * Shutdown HTTP server
   */
  shutdown(): Promise<void>;
}
//#endregion
export { SocketConnector };
//# sourceMappingURL=socket-connector.d.mts.map