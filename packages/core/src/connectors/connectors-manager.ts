import config from "@mongez/config";
import { performance } from "node:perf_hooks";
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
import { DEFAULT_SHUTDOWN_TIMEOUT } from "./shutdown-timeout";
import { ConnectorLifecyclePhase } from "./types";
import type { Connector, ConnectorName } from "./types";

/**
 * How long one connector took to `boot()` or `start()`.
 */
export type ConnectorTiming = {
  connector: ConnectorName;
  step: "boot" | "start";
  ms: number;
};

export class ConnectorsManager {
  /**
   * Receives the duration of every `boot()` and `start()` this manager runs.
   * Set by the test runtime's boot profile; unset (and free) otherwise.
   */
  private timingObserver?: (timing: ConnectorTiming) => void;

  /**
   * Connectors list
   */
  private readonly connectors: Connector[] = [];

  /**
   * The names the framework's own connectors hold.
   *
   * Filled by the constructor's own registration calls rather than declared
   * beside them, so there is exactly ONE place a built-in name exists: the
   * connector that owns it. A second list — in the builder, in a config
   * validator, in a test double — is a list that drifts the moment a built-in
   * is added or renamed, and it drifts silently, because nothing compares the
   * two. Both halves of a connector's life read this one through
   * {@link isBuiltInName}: the build refuses a `connectors` array that claims
   * a built-in name, and so does registration.
   */
  private readonly builtInNames = new Set<string>();

  /**
   * Constructor
   */
  public constructor() {
    this.registerBuiltIn(new LoggerConnector());
    this.registerBuiltIn(new MailerConnector());
    this.registerBuiltIn(new HttpConnector());
    this.registerBuiltIn(new DatabaseConnector());
    this.registerBuiltIn(new HeraldConnector());
    this.registerBuiltIn(new CacheConnector());
    this.registerBuiltIn(new StorageConnector());
    this.registerBuiltIn(new SocketConnector());
    this.registerBuiltIn(new NotificationsConnector());
    this.registerBuiltIn(new AccessConnector());
    this.registerBuiltIn(new AiConnector());
  }

  /**
   * Register a framework-owned connector and reserve its name.
   *
   * Private on purpose: an app connector must not be able to reserve a name,
   * and the set is only correct if every entry in it came from a connector
   * this class constructed itself.
   */
  private registerBuiltIn(...connectors: Connector[]): void {
    for (const connector of connectors) {
      this.builtInNames.add(connector.name);
    }

    this.register(...connectors);
  }

  /**
   * Whether the given name belongs to a framework built-in connector.
   *
   * Reserved, not merely taken: a configured connector carrying one of these
   * names would be skipped by {@link has} at boot while the build had already
   * drained its contribution, so the artifact would carry a connector the
   * server never runs. Callers refuse the name instead of skipping it.
   */
  public isBuiltInName(name: string): boolean {
    return this.builtInNames.has(name);
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
   * Report how long each connector's `boot()` and `start()` takes, or stop
   * reporting with `undefined`. Used by the test boot profile.
   */
  public observeTimings(observer: ((timing: ConnectorTiming) => void) | undefined): void {
    this.timingObserver = observer;
  }

  /**
   * Run one lifecycle call, reporting its duration to the observer when set.
   */
  private async timed(
    connector: Connector,
    step: ConnectorTiming["step"],
    run: () => Promise<void>,
  ): Promise<void> {
    const observer = this.timingObserver;

    if (!observer) return run();

    const started = performance.now();

    try {
      await run();
    } finally {
      observer({ connector: connector.name, step, ms: performance.now() - started });
    }
  }

  /**
   * Get all connectors
   */
  public list(): Connector[] {
    return this.connectors;
  }

  /**
   * Whether a connector with the given name is already registered.
   *
   * Names are the identity of a connector here, which is what lets a caller
   * that may run more than once per process register idempotently instead of
   * stacking duplicates that would each boot and shut down.
   */
  public has(name: ConnectorName): boolean {
    return this.connectors.some((connector) => connector.name === name);
  }

  /**
   * start all connectors
   */
  public async start(connectorsNames?: ConnectorName[]): Promise<void> {
    const connectorsList = connectorsNames
      ? this.connectors.filter((connector) => connectorsNames.includes(connector.name))
      : this.connectors;

    for (const connector of connectorsList) {
      await this.timed(connector, "boot", () => connector.boot());
    }

    for (const connector of connectorsList) {
      await this.timed(connector, "start", () => connector.start());
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
      await this.timed(connector, "boot", () => connector.boot());
    }

    for (const connector of phaseConnectors) {
      await this.timed(connector, "start", () => connector.start());
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

    // HTTP stops accepting and drains in-flight requests FIRST, while storage,
    // socket, etc. are still up; then the rest go in reverse priority. Copy the
    // list first — `reverse()` mutates in place, so reversing the live array
    // would corrupt the order on a second shutdown pass.
    const reversed = [...this.connectors].reverse();
    const ordered = [
      ...reversed.filter((connector) => connector.name === "http"),
      ...reversed.filter((connector) => connector.name !== "http"),
    ];

    const timeout = config.get("app.shutdownTimeout", DEFAULT_SHUTDOWN_TIMEOUT);
    let current: string | undefined;

    const timer = setTimeout(() => {
      // Sync write: the process exits right after, so an async log would be lost.
      console.error(
        `Shutdown timed out after ${timeout}ms; connector still shutting down: ${current ?? "none"}`,
      );
      process.exit(1);
    }, timeout);
    timer.unref?.();

    try {
      for (const connector of ordered) {
        current = connector.name;
        await this.shutdownOne(connector);
      }
      current = undefined;
    } finally {
      clearTimeout(timer);
    }

    // Log calls return before an async channel (file, Sentry) has written the
    // entry, so a channel would lose it when the process exits; `flush()` waits
    // for those deliveries.
    await log.flush();
  }

  /**
   * Shut one connector down, isolating and reporting its failure.
   */
  private async shutdownOne(connector: Connector): Promise<void> {
    try {
      await connector.shutdown();
    } catch (error) {
      try {
        // Synchronous: the entry is handed to every channel before this
        // returns. `shutdown()` then flushes async channels before resolving,
        // because the caller (`shutdownOnProcessKill`) calls `process.exit(0)`
        // as soon as it does.
        log.error("connectors", "shutdown", error as Error, { connector: connector.name });
      } catch {
        // Reporting a failure must never become a worse failure than the one
        // being reported: anything thrown here (a redact rule, say) would
        // otherwise abort the remaining teardown. Swallowed
        // rather than re-reported: the only channel we could report it through
        // is the one that just threw.
      }
    }
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
