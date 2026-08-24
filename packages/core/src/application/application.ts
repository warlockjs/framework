import { log } from "@warlock.js/logger";
import { BOOT_SIGNAL_VERSION, sendBootSignal } from "./boot-signal";
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
 * A callback registered through `Application.onValidateBoot`. May be async —
 * unlike {@link BootListener}, its rejection is NOT caught: it aborts boot.
 *
 * Use this for configuration that makes the application WRONG rather than
 * degraded when missing (a signing secret, a required integration key) — the
 * kind of check that must fail closed. Use `onceBooted` for everything else;
 * that contract stays fire-and-forget on purpose (it is the right behaviour
 * for plugins reacting to boot, not for gating it).
 */
export type BootValidator = () => void | Promise<void>;

/**
 * `new Error(message, { cause })` is ES2022, and this package still compiles
 * against the ES2020 lib, where `Error` is typed as taking a message only.
 * Node has supported the option since v16, so this is the type layer
 * catching up with the runtime, not a change in what the code does. Same
 * workaround as `image.ts` (see #16).
 */
type ErrorWithCauseConstructor = new (message: string, options: { cause: unknown }) => Error;

const ErrorWithCause = Error as ErrorWithCauseConstructor;

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
   * Whether `runStartupValidators` has already run. Flipped once, so a
   * validator registered afterwards is refused instead of silently skipped
   * or run too late to matter.
   */
  private static validated = false;

  /**
   * Startup validators queued before `runStartupValidators` ran, drained in
   * registration order.
   */
  private static bootValidators: BootValidator[] = [];

  /**
   * The http port this process actually bound, once it has. Reported in the
   * readiness signal so a supervisor knows where to send its health check
   * instead of re-deriving it from config it may not be able to read.
   * Undefined for an app with no http connector — a queue worker still boots.
   */
  private static servedPort: number | undefined;

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
   * Record the http port this process bound.
   *
   * @internal The http connector calls this after a successful `listen`.
   */
  public static setServedPort(port: number): void {
    this.servedPort = port;
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
   * Also reports readiness to a supervising parent process — this is the one
   * moment in the lifecycle where "the application is serving" is true, so it
   * is the only honest source for `warlock start`'s success banner. Sent before
   * the listeners run: a slow or hanging `onceBooted` listener must not delay
   * the parent's view of a server that is already accepting requests.
   *
   * @internal Framework entry points call this; application code must not.
   */
  public static markBooted(context: BootContext): void {
    if (this.booted) {
      return;
    }

    this.booted = true;
    this.bootContext = context;

    sendBootSignal({
      type: "warlock:ready",
      version: BOOT_SIGNAL_VERSION,
      pid: process.pid,
      at: new Date().toISOString(),
      environment: context.environment,
      runtimeStrategy: context.runtimeStrategy,
      bootDurationMs: context.bootDurationMs,
      port: this.servedPort,
    });

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
   * Register a startup validator — distinct from {@link onceBooted}. A
   * rejecting validator aborts boot instead of being caught and logged, so
   * this is where configuration that must fail closed belongs (a signing
   * secret, a required integration key), not `onceBooted`.
   *
   * Must be registered before the framework calls `runStartupValidators` —
   * typically at module scope in `src/app/main.ts`, the same place a
   * `BootListener` would be registered. Registering one after validation has
   * already run throws: by then a rejection could no longer stop the app
   * from serving, so running it late would silently defeat the guarantee
   * this hook exists to give.
   *
   * @example
   * Application.onValidateBoot(() => {
   *   if (!env("JWT_SECRET")) {
   *     throw new Error(
   *       "JWT_SECRET is not set. Sessions cannot be signed without it. " +
   *         "Generate one with `yarn jwt` and put it in .env.",
   *     );
   *   }
   * });
   */
  public static onValidateBoot(validator: BootValidator): void {
    if (this.validated) {
      throw new Error(
        "Application.onValidateBoot(): startup validators already ran — " +
          "this validator was registered too late to block boot. Register it " +
          "before the framework calls Application.runStartupValidators(), " +
          "typically at module scope in `src/app/main.ts`.",
      );
    }

    this.bootValidators.push(validator);
  }

  /**
   * Run every registered startup validator, in registration order, and abort
   * on the first rejection. Idempotent — a second call is a no-op.
   *
   * Distinct from `runBootListener`: a listener's failure is isolated so it
   * can never break boot; a validator's failure IS the boot failing — that is
   * the entire point of registering one instead of the other. The thrown
   * error names the failing validator and the original cause, so whatever
   * catches it (the dev server's boot try/catch, the production entry's
   * top-level await) reports which check failed and why, not a bare
   * rejection.
   *
   * @internal Framework entry points call this once app code (main.ts et al)
   * has loaded and BEFORE late-phase connectors (http, socket) start, so a
   * failing validator runs before anything can bind a port or accept a
   * request. Application code must not call this directly.
   */
  public static async runStartupValidators(): Promise<void> {
    if (this.validated) {
      return;
    }

    this.validated = true;

    const validators = this.bootValidators;
    this.bootValidators = [];

    for (const validator of validators) {
      try {
        await validator();
      } catch (error) {
        const name = validator.name || "<anonymous>";
        const cause = error instanceof Error ? error.message : String(error);

        throw new ErrorWithCause(
          `Startup validator "${name}" rejected boot: ${cause}. ` +
            `Fix the condition it checks, or remove the validator if it no ` +
            `longer applies — boot cannot proceed while it fails.`,
          { cause: error },
        );
      }
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
