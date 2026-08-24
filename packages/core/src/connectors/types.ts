import type { BuildOptions } from "esbuild";
import type { ResolvedBuildConfig } from "../production/resolve-build-config";

/**
 * Connector Interface
 * All service connectors (Database, HTTP, Cache, etc.) must implement this interface
 */
export interface Connector {
  /**
   * Unique name of the connector
   */
  readonly name: ConnectorName;

  /**
   * Priority for initialization order
   * Lower numbers initialize first (e.g., Database: 1, HTTP: 3)
   */
  readonly priority: number;

  /**
   * Phase the connector boots in, relative to user code.
   * See `ConnectorLifecyclePhase` for semantics.
   */
  readonly lifecyclePhase: ConnectorLifecyclePhase;

  /**
   * Whether the connector is currently active/connected
   */
  isActive(): boolean;

  /**
   * Boot the connector
   * Called during server startup before starting the connector
   */
  boot(): void | Promise<void>;

  /**
   * Initialize the connector
   * Called during server startup
   */
  start(): Promise<void>;

  /**
   * Restart the connector
   * Called when watched files change
   */
  restart(): Promise<void>;

  /**
   * Gracefully shutdown the connector
   * Called during server shutdown
   */
  shutdown(): Promise<void>;

  /**
   * Determine if this connector needs restart based on changed files
   * @param changedFiles Array of relative file paths that changed
   * @returns true if connector should restart
   */
  shouldRestart(changedFiles: string[]): boolean;

  /**
   * What this connector contributes to `warlock build`.
   *
   * Read STATICALLY from `warlock.config.ts > connectors` — `warlock build`
   * never calls `boot()`/`start()`, so nothing here may assume a running
   * connector. The same `connectors` key drives both halves of a connector's
   * life — build-time contribution and runtime boot; see
   * {@link ConnectorBuildContribution}.
   */
  readonly build?: ConnectorBuildContribution;
}

/**
 * What a build contribution is handed. Everything it needs to write files
 * and shape the bundle, and nothing that would let it reach the runtime.
 */
export type ConnectorBuildContext = {
  /** Absolute path to `.warlock/production` — deleted after the build */
  productionDir: string;
  /** Absolute path to the application root (where `package.json` lives) */
  appRoot: string;
  /** The build config after framework defaults and user overrides */
  options: ResolvedBuildConfig;
};

/**
 * The esbuild options a contributor may patch.
 *
 * Deliberately a narrow `Pick`, not `Partial<BuildOptions>`: `entryPoints`,
 * `tsconfig` and `tsconfigRaw` stay forbidden here for the same reason they
 * are forbidden in the user's `build` block — they re-compile every file in
 * the bundle, workspace packages included (see `ForbiddenBuildOptionError`).
 * A contributor reaching them would reintroduce the failure the user-level
 * guard exists to prevent.
 */
export type ConnectorEsbuildPatch = Pick<
  BuildOptions,
  "jsx" | "jsxImportSource" | "define" | "external" | "loader"
>;

/**
 * What `generate` may hand back to the builder.
 */
export type ConnectorBuildGenerateResult = {
  /**
   * Lines appended verbatim to section 4 of the generated entry, AFTER the
   * `./routes` import — page registration must see the routes app code
   * collected, mirroring dev's ordering.
   *
   * @example ['await import("./pages");']
   */
  entryImports?: string[];
  /** Merged into the esbuild call: defaults < this patch < user `build` */
  esbuild?: ConnectorEsbuildPatch;
};

/**
 * A connector's build-time half: two hooks, both awaited, drained in
 * `connectors` array order. A hook that throws fails the build.
 *
 * **This type is closed on purpose**: exactly these two optional function properties and ZERO data-bearing
 * fields. There is deliberately no property where a Vite/babel plugin
 * instance, an alias map or a compiled pipeline could live, so
 * `build: { plugins: [...] }` is a type error rather than something a
 * reviewer has to catch. Anything heavy must be constructed INSIDE a hook,
 * after that hook dynamically imports it — that is what keeps a connector's
 * static import graph out of the runtime closure. The drain mirrors this at
 * read time by rejecting unknown enumerable keys (`assertClosedContribution`):
 * the type narrows, the runtime asserts.
 */
export type ConnectorBuildContribution = {
  /**
   * Write files into `ctx.productionDir` and/or patch the bundle.
   *
   * Runs after the generated-imports check and before esbuild bundles.
   */
  generate?(
    context: ConnectorBuildContext,
  ): Promise<ConnectorBuildGenerateResult | void> | ConnectorBuildGenerateResult | void;

  /**
   * Produce artifacts esbuild does not — e.g. a client bundle.
   *
   * Runs after esbuild and before `.warlock/production` is removed.
   */
  emit?(context: ConnectorBuildContext): Promise<void> | void;
};

export type ConnectorName =
  | "logger"
  | "mailer"
  | "http"
  | "database"
  | "cache"
  | "storage"
  | "herald"
  | "socket"
  | "notifications"
  | "access"
  | "ai"
  | (string & {});

/**
 * When a connector boots relative to user code (main, routes, events).
 *
 * - `Early`: before user code is imported. For services user code
 *   needs at import time (database, cache, logger, storage, mailer).
 * - `Late`: after user code is imported. For services that bind to
 *   things user code registered (http scans the router; socket
 *   depends on http's instance).
 */
export enum ConnectorLifecyclePhase {
  Early = "early",
  Late = "late",
}

/**
 * Connector priority constants
 */
export enum ConnectorPriority {
  LOGGER = 0,
  MAILER = 1,
  DATABASE = 2,
  COMMUNICATOR = 3,
  CACHE = 4,
  HTTP = 5,
  STORAGE = 6,
  SOCKET = 7,
  NOTIFICATIONS = 8,
  ACCESS = 9,
  AI = 10,
}
