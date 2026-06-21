import { log } from "@warlock.js/logger";
import {
  environment,
  setEnvironment,
  type Environment,
  type RuntimeStrategy,
} from "../utils/environment";
import { getFrameworkVersion } from "../utils/framework-vesion";
import { appPath, publicPath, rootPath, srcPath, storagePath, uploadsPath } from "../utils/paths";

/**
 * Snapshot of the global facts known the moment the application finished
 * booting: every connector (early + late) is active and all app files
 * (locales, events, main, routes) are loaded. Passed to every
 * `Application.onceBooted` listener and resolved from `Application.whenBooted`.
 */
export type BootContext = {
  environment: Environment;
  runtimeStrategy: RuntimeStrategy;
  /**
   * Wall-clock milliseconds the boot took. The dev server measures it; the
   * production entry omits it.
   */
  bootDurationMs?: number;
};

/**
 * A callback registered through `Application.onceBooted`. May be async — its
 * rejection is caught and logged so a single listener can never break boot or
 * the other listeners.
 */
export type BootListener = (context: BootContext) => void | Promise<void>;

/**
 * A callback registered through `Application.onShutdown`. Runs once, while the
 * connectors (db, cache, http) are still up, so it can release app-owned
 * resources cleanly. May be async — its rejection is caught and logged.
 */
export type ShutdownListener = () => void | Promise<void>;

export class Application {
  /**
   * Project start time regarding the process start time
   */
  public static readonly startedAt = new Date(Date.now() - process.uptime() * 1000);

  /**
   * Runtime strategy
   */
  public static runtimeStrategy: RuntimeStrategy;

  /**
   * Whether the application has finished booting. Flipped once by `markBooted`.
   */
  private static booted = false;

  /**
   * The boot context, set once booted so it can be replayed to late subscribers.
   */
  private static bootContext: BootContext | undefined;

  /**
   * Listeners queued before boot completed, drained in registration order by
   * `markBooted`.
   */
  private static bootListeners: BootListener[] = [];

  /**
   * Whether the application has begun (or finished) shutting down. Flipped once
   * by `runShutdownHooks`.
   */
  private static shuttingDown = false;

  /**
   * Teardown callbacks, run once when shutdown begins.
   */
  private static shutdownListeners: ShutdownListener[] = [];

  /**
   * Get framework version
   */
  public static get version() {
    return getFrameworkVersion();
  }

  /**
   * Set the runtime strategy
   */
  public static setRuntimeStrategy(strategy: RuntimeStrategy) {
    this.runtimeStrategy = strategy;
  }

  /**
   * Whether the application has finished booting — every connector in both
   * the early and late phases is active and all app files (locales, events,
   * main, routes) have been loaded.
   */
  public static get isBooted(): boolean {
    return this.booted;
  }

  /**
   * Run a callback once the application is fully booted.
   *
   * App files (`main` / `events` / `routes` / locales) are imported BEFORE the
   * late-phase connectors (http, socket) start, so a listener registered at
   * import time waits for the whole sequence to finish before it runs. If the
   * application is already booted, the callback runs on the next microtask —
   * so a late subscriber never silently misses the event.
   *
   * @example
   * Application.onceBooted(({ environment }) => {
   *   log.info("app", "booted", `ready in ${environment}`);
   * });
   */
  public static onceBooted(listener: BootListener): void {
    if (this.booted && this.bootContext) {
      const context = this.bootContext;
      void this.runBootListener(listener, context);

      return;
    }

    this.bootListeners.push(listener);
  }

  /**
   * Promise form of {@link onceBooted} — resolves with the boot context once
   * the application is booted, or immediately if it already is.
   */
  public static whenBooted(): Promise<BootContext> {
    if (this.booted && this.bootContext) {
      return Promise.resolve(this.bootContext);
    }

    return new Promise<BootContext>((resolve) => {
      this.onceBooted((context) => resolve(context));
    });
  }

  /**
   * Flip the boot latch and drain every queued listener. The dev server and
   * the production entry call this once, right after the late phase starts. It
   * is idempotent — a second call is a no-op, so a double-invoke can never
   * double-fire listeners.
   *
   * @internal Framework entry points call this; application code must not.
   */
  public static markBooted(context: BootContext): void {
    if (this.booted) {
      return;
    }

    this.booted = true;
    this.bootContext = context;

    const listeners = this.bootListeners;
    this.bootListeners = [];

    for (const listener of listeners) {
      void this.runBootListener(listener, context);
    }
  }

  /**
   * Invoke a single boot listener, isolating its failure so neither boot nor
   * the remaining listeners are affected.
   */
  private static async runBootListener(
    listener: BootListener,
    context: BootContext,
  ): Promise<void> {
    try {
      await listener(context);
    } catch (error) {
      log.error("application", "booted-listener", error as Error);
    }
  }

  /**
   * Whether the application has begun shutting down. Once true, readiness
   * checks report not-ready so a load balancer drains this instance before the
   * HTTP server stops accepting requests.
   */
  public static get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Register a teardown callback, run once when the application shuts down —
   * before the connectors (db, cache, http) are torn down, so it can still use
   * them. The natural place to close an app-owned resource opened in
   * `onceBooted`. If shutdown has already begun, the callback runs immediately.
   *
   * @example
   * Application.onShutdown(async () => {
   *   await myQueueConsumer.stop();
   * });
   */
  public static onShutdown(listener: ShutdownListener): void {
    if (this.shuttingDown) {
      void this.runShutdownListener(listener);

      return;
    }

    this.shutdownListeners.push(listener);
  }

  /**
   * Flip the shutdown latch and run every teardown callback. The connectors
   * manager calls this at the start of shutdown — before any connector is torn
   * down. Idempotent and error-isolated: each callback is awaited, a thrown one
   * is logged and does not stop the rest. Listeners run LIFO (reverse of
   * registration), mirroring resource-unwind order.
   *
   * @internal Framework entry points call this; application code must not.
   */
  public static async runShutdownHooks(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;

    const listeners = this.shutdownListeners.reverse();
    this.shutdownListeners = [];

    for (const listener of listeners) {
      await this.runShutdownListener(listener);
    }
  }

  /**
   * Invoke a single teardown callback, isolating its failure so the rest still
   * run and shutdown is never blocked by one bad hook.
   */
  private static async runShutdownListener(listener: ShutdownListener): Promise<void> {
    try {
      await listener();
    } catch (error) {
      log.error("application", "shutdown-listener", error as Error);
    }
  }

  /**
   * Get project uptime in milliseconds
   */
  public static get uptime(): number {
    return process.uptime() * 1000;
  }

  /**
   * Get the current environment
   */
  public static get environment(): Environment {
    return environment();
  }

  /**
   * Set the current environment
   */
  public static setEnvironment(env: Environment) {
    setEnvironment(env);
  }

  /**
   * Check if the application is running in production environment
   */
  public static get isProduction(): boolean {
    return this.environment === "production";
  }

  /**
   * Check if the application is running in development environment
   */
  public static get isDevelopment(): boolean {
    return this.environment === "development";
  }

  /**
   * Check if the application is running in test environment
   */
  public static get isTest(): boolean {
    return this.environment === "test";
  }

  /**
   * Get the root path
   */
  public static get rootPath(): string {
    return rootPath();
  }

  /**
   * Get the src path
   */
  public static get srcPath(): string {
    return srcPath();
  }

  /**
   * Get the app path
   */
  public static get appPath(): string {
    return appPath();
  }

  /**
   * Get the storage path
   */
  public static get storagePath(): string {
    return storagePath();
  }

  /**
   * Get the uploads path
   */
  public static get uploadsPath(): string {
    return uploadsPath();
  }

  /**
   * Get the public path
   */
  public static get publicPath(): string {
    return publicPath();
  }
}
