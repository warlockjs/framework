import { Path } from "../dev-server/path";
import { ConnectorLifecyclePhase } from "./types";
import type { Connector, ConnectorName } from "./types";

/**
 * Base Connector Class
 * Provides common functionality for all connectors
 */
export abstract class BaseConnector implements Connector {
  /**
   * Connector name
   */
  public abstract readonly name: ConnectorName;

  /**
   * Initialization priority
   */
  public abstract readonly priority: number;

  /**
   * Lifecycle phase. Defaults to `Early`; override to `Late` if the
   * connector consumes state user code registers at import time
   * (routes, socket listeners).
   */
  public readonly lifecyclePhase: ConnectorLifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger restart when changed
   * Use relative paths
   */
  protected abstract readonly watchedFiles: string[];

  /**
   * Whether the connector is currently active
   */
  protected active: boolean = false;

  /**
   * Check if connector is active
   */
  public isActive(): boolean {
    return this.active;
  }

  /**
   * Boot the connector
   */
  public async boot(): Promise<void> {
    return;
  }

  /**
   * Initialize the connector
   */
  public abstract start(): Promise<void>;

  /**
   * Restart the connector
   */
  public async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

  /**
   * Shutdown the connector
   */
  public abstract shutdown(): Promise<void>;

  /**
   * Determine if connector should restart based on changed files
   */
  public shouldRestart(changedFiles: string[]): boolean {
    // Check if any changed file matches watched files
    return changedFiles.some((file) => this.isWatchedFile(file));
  }

  /**
   * Check if a file is watched by this connector
   */
  protected isWatchedFile(file: string): boolean {
    const relativePath = Path.toRelative(file);

    return this.watchedFiles.some((watchedFile) => {
      // Exact match
      if (watchedFile === relativePath) {
        return true;
      }

      // Pattern match (e.g., "config/*.ts")
      if (watchedFile.includes("*")) {
        const pattern = new RegExp("^" + watchedFile.replace(/\*/g, ".*") + "$");
        return pattern.test(relativePath);
      }

      return false;
    });
  }
}
