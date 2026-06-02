import { Connector, ConnectorLifecyclePhase, ConnectorName } from "./types.mjs";

//#region ../../@warlock.js/core/src/connectors/connectors-manager.d.ts
declare class ConnectorsManager {
  /**
   * Connectors list
   */
  private readonly connectors;
  /**
   * Constructor
   */
  constructor();
  /**
   * Register a connector
   */
  register(...connectors: Connector[]): void;
  /**
   * Get all connectors
   */
  list(): Connector[];
  /**
   * start all connectors
   */
  start(connectorsNames?: ConnectorName[]): Promise<void>;
  /**
   * Start all connectors in the given lifecycle phase.
   *
   * The production builder and dev preload split startup around app
   * code: early phase before app imports, late phase after. Within a
   * phase, all connectors `boot()` first, then all `start()`, so
   * cross-connector wiring inside the phase still works (e.g. socket
   * reads http's instance during its own boot).
   */
  startPhase(phase: ConnectorLifecyclePhase): Promise<void>;
  /**
   * Start all connectors except the given ones
   */
  startWithout(excludedConnectors: ConnectorName[]): Promise<void>;
  /**
   * Shutdown all connectors
   */
  shutdown(): Promise<void>;
  /**
   * Shutdown connectors on process kill
   *
   * Handles graceful shutdown for both Unix and Windows:
   * - SIGINT: Ctrl+C on Unix, also caught on Windows but unreliable in child processes
   * - SIGTERM: Termination signal (Unix primarily)
   * - beforeExit: Fires when Node.js empties its event loop (more reliable on Windows)
   */
  shutdownOnProcessKill(): void;
}
declare const connectorsManager: ConnectorsManager;
//#endregion
export { ConnectorsManager, connectorsManager };
//# sourceMappingURL=connectors-manager.d.mts.map