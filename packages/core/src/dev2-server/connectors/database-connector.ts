import config from "@mongez/config";
import { connection, connectToDatabase } from "@warlock.js/cascade";
import { BaseConnector } from "./base-connector";
import { ConnectorPriority } from "./types";

/**
 * Database Connector
 * Manages database connection lifecycle
 */
export class DatabaseConnector extends BaseConnector {
  public readonly name = "Database";
  public readonly priority = ConnectorPriority.DATABASE;

  /**
   * Files that trigger database restart
   */
  protected readonly watchedFiles = [".env", "src/config/database.ts", "src/config/database.tsx"];

  /**
   * Initialize database connection
   */
  public async start(): Promise<void> {
    // TODO: Implement actual database connection
    // - Check if config/database.ts exists
    // - Load database configuration
    // - Connect to database using @warlock.js/cascade or similar
    // - Handle connection errors
    const databaseConfig = config.get("database");

    if (!databaseConfig) return;

    await connectToDatabase(databaseConfig);

    this.active = true;
  }

  /**
   * Shutdown database connection
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    // TODO: Implement actual database disconnection
    // - Close all active connections
    // - Clean up resources

    // await disconnectDatabase();

    await connection.client?.close();

    (connection as any).isConnectionEstablished = false;

    this.active = false;
  }
}
