import { colors } from "@mongez/copper";
import { devServeLog } from "../dev-server/dev-logger";
import { AccessConnector } from "./access-connector";
import { CacheConnector } from "./cache-connector";
import { DatabaseConnector } from "./database-connector";
import { HeraldConnector } from "./herald-connector";
import { HttpConnector } from "./http-connector";
import { LoggerConnector } from "./logger-connector";
import { MailerConnector } from "./mail-connector";
import { NotificationsConnector } from "./notifications-connector";
import { SocketConnector } from "./socket-connector";
import { StorageConnector } from "./storage.connector";
import { ConnectorLifecyclePhase } from "./types";
import type { Connector, ConnectorName } from "./types";

export class ConnectorsManager {
  /**
   * Connectors list
   */
  private readonly connectors: Connector[] = [];

  /**
   * Constructor
   */
  public constructor() {
    this.register(new LoggerConnector());
    this.register(new MailerConnector());
    this.register(new HttpConnector());
    this.register(new DatabaseConnector());
    this.register(new HeraldConnector());
    this.register(new CacheConnector());
    this.register(new StorageConnector());
    this.register(new SocketConnector());
    this.register(new NotificationsConnector());
    this.register(new AccessConnector());
  }

  /**
   * Register a connector
   */
  public register(...connectors: Connector[]): void {
    this.connectors.push(...connectors);
    // sort connectors by priority
    this.connectors.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get all connectors
   */
  public list(): Connector[] {
    return this.connectors;
  }

  /**
   * start all connectors
   */
  public async start(connectorsNames?: ConnectorName[]): Promise<void> {
    const connectorsList = connectorsNames
      ? this.connectors.filter((connector) => connectorsNames.includes(connector.name))
      : this.connectors;

    for (const connector of connectorsList) {
      await connector.boot();
    }

    for (const connector of connectorsList) {
      await connector.start();
    }
  }

  /**
   * Start all connectors in the given lifecycle phase.
   *
   * The production builder and dev preload split startup around app
   * code: early phase before app imports, late phase after. Within a
   * phase, all connectors `boot()` first, then all `start()`, so
   * cross-connector wiring inside the phase still works (e.g. socket
   * reads http's instance during its own boot).
   */
  public async startPhase(phase: ConnectorLifecyclePhase): Promise<void> {
    const phaseConnectors = this.connectors.filter(
      (connector) => connector.lifecyclePhase === phase,
    );

    for (const connector of phaseConnectors) {
      await connector.boot();
    }

    for (const connector of phaseConnectors) {
      await connector.start();
    }
  }

  /**
   * Start all connectors except the given ones
   */
  public async startWithout(excludedConnectors: ConnectorName[]): Promise<void> {
    await this.start(
      this.connectors
        .filter((connector) => !excludedConnectors.includes(connector.name))
        .map((connector) => connector.name),
    );
  }

  /**
   * Shutdown all connectors
   */
  public async shutdown(): Promise<void> {
    // shut down connectors in reverse order
    for (const connector of this.connectors.reverse()) {
      try {
        await connector.shutdown();
      } catch (error) {
        devServeLog(colors.redBright(`❌ Failed to shutdown ${connector.name}: ${error}`));
      }
    }
  }

  /**
   * Shutdown connectors on process kill
   *
   * Handles graceful shutdown for both Unix and Windows:
   * - SIGINT: Ctrl+C on Unix, also caught on Windows but unreliable in child processes
   * - SIGTERM: Termination signal (Unix primarily)
   * - beforeExit: Fires when Node.js empties its event loop (more reliable on Windows)
   */
  public shutdownOnProcessKill(): void {
    let isShuttingDown = false;

    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log(`\nExiting...`);
      await this.shutdown();
      process.exit(0);
    };

    // Unix signals
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    // Windows-specific: handle when process is about to exit
    // This is more reliable on Windows for spawned child processes
    if (process.platform === "win32") {
      // Handle Ctrl+C on Windows specifically
      process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
    }
  }
}

export const connectorsManager = new ConnectorsManager();
