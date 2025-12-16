/**
 * Connector Interface
 * All service connectors (Database, HTTP, Cache, etc.) must implement this interface
 */
export interface Connector {
  /**
   * Unique name of the connector
   */
  readonly name: string;

  /**
   * Priority for initialization order
   * Lower numbers initialize first (e.g., Database: 1, HTTP: 3)
   */
  readonly priority: number;

  /**
   * Whether the connector is currently active/connected
   */
  isActive(): boolean;

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

/**
 * Connector priority constants
 */
export enum ConnectorPriority {
  DATABASE = 1,
  CACHE = 2,
  HTTP = 3,
}

