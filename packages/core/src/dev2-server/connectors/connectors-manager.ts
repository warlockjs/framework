import { colors } from "@mongez/copper";
import { devServeLog } from "../dev-logger";
import { CacheConnector } from "./cache-connector";
import { DatabaseConnector } from "./database-connector";
import { HttpConnector } from "./http-connector";
import type { Connector } from "./types";

export class ConnectorsManager {
  /**
   * Connectors lsit
   */
  private readonly connectors: Connector[] = [];

  /**
   * Constructor
   */
  public constructor() {
    this.register(new HttpConnector());
    this.register(new DatabaseConnector());
    this.register(new CacheConnector());
  }

  /**
   * Register a connector
   */
  public register(connector: Connector): void {
    this.connectors.push(connector);
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
  public async start(connectorsNames?: string[]): Promise<void> {
    for (const connector of this.connectors) {
      if (connectorsNames && !connectorsNames.includes(connector.name)) continue;

      await connector.start();
    }
  }

  /**
   * Shutdown all connectors
   */
  public async shutdown(): Promise<void> {
    for (const connector of this.connectors) {
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
