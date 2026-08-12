import { Application } from "../application";
import { log } from "@warlock.js/logger";
import { AccessConnector } from "./access-connector";
import { AiConnector } from "./ai-connector";
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
    this.register(new AiConnector());
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
    // App-owned teardown runs first, while every connector (db, cache, http) is
    // still up, so cleanup hooks can use them. Idempotent + error-isolated.
    await Application.runShutdownHooks();

    // Shut down connectors in reverse priority order. Copy the list first —
    // `reverse()` mutates in place, so reversing the live array would corrupt
    // the order on a second shutdown pass.
    for (const connector of [...this.connectors].reverse()) {
      try {
        await connector.shutdown();
      } catch (error) {
        try {
          // Awaited deliberately: the caller (`shutdownOnProcessKill`) calls
          // `process.exit(0)` as soon as this resolves, so an un-awaited log is
          // a log that never happens.
          await log.error("connectors", "shutdown", error as Error, { connector: connector.name });
        } catch {
          // Reporting a failure must never become a worse failure than the one
          // being reported. `Logger.log()` fans out to channels without
          // isolating them, so a channel that throws synchronously rejects this
          // call — and this call sits INSIDE the catch, so that rejection
          // escapes `shutdown()` entirely: the remaining connectors are never
          // torn down and `process.exit(0)` never runs, leaving the process
          // alive on the handles they still hold.
          //
          // Swallowed rather than re-reported: the only channel we could report
          // it through is the one that just threw.
        }
      }
    }

    // `Logger.log()` hands each entry to `channel.log()` without awaiting it, so
    // awaiting the calls above is not enough on its own — a buffered or async
    // channel (file, Sentry) still loses the entry when the process exits.
    // Drained once here rather than per failure: shutdown is exactly when
    // buffered logs must reach their destination, and re-draining every channel
    // once per failed connector buys nothing.
    await log.flush();
  }

  /**
   * Shutdown connectors on process kill
   *
   * Registers signal handlers that run an idempotent graceful shutdown:
   * - SIGINT: Ctrl+C on Unix, also caught on Windows but unreliable in child processes
   * - SIGTERM: Termination signal (Unix primarily)
   * - SIGHUP: registered on Windows (`win32`) only, to catch Ctrl+C / console close
   *
   * Note: no `beforeExit` handler is registered — `beforeExit` cannot reliably
   * await async teardown (the process exits once the callback returns), so
   * shutdown is driven entirely by the signal handlers above.
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
