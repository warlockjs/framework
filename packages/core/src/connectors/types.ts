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
}

export type ConnectorName =
  | "logger"
  | "mailer"
  | "http"
  | "database"
  | "cache"
  | "storage"
  | "communicator"
  | "socket"
  | "notifications"
  | "access"
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
}
