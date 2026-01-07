import { DriverContract } from "../contracts";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { MongoDbDriver } from "../drivers/mongo/mongodb-driver";
import type { DeleteStrategy, StrictMode } from "../types";

/**
 * Supported database driver types.
 */
export type DatabaseDriver = "mongodb" | "postgres" | "mysql";

/**
 * Default model configuration options.
 *
 * These settings will be applied to all models using this data source,
 * unless overridden by individual model static properties.
 *
 * Note: `autoGenerateId` is NOT included here as it's a driver-level
 * setting (configured in MongoDriverOptions), not a model-level one.
 */
export type ModelDefaultConfig = {
  /**
   * Initial ID value for auto-generated IDs.
   * Can be a number or a function that returns a number.
   * @default 1
   */
  initialId?: number | (() => number);

  /**
   * Randomly generate the initial ID.
   * - `true`: Random ID between 10000-499999
   * - Function: Custom random ID generator
   * @default false
   */
  randomInitialId?: boolean | (() => number);

  /**
   * Amount to increment ID by for each new record.
   * @default 1
   */
  incrementIdBy?: number;

  /**
   * Randomly generate the increment amount.
   * - `true`: Random increment between 1-10
   * - Function: Custom random increment generator
   * @default false
   */
  randomIncrement?: boolean | (() => number);

  /**
   * Default delete strategy for models.
   * @default undefined (uses data source default or "permanent")
   */
  deleteStrategy?: DeleteStrategy;

  /**
   * Default validation strict mode.
   * - `"allow"`: Allow unknown fields
   * - `"strip"`: Strip unknown fields
   * - `"fail"`: Fail on unknown fields
   * @default "strip"
   */
  strictMode?: StrictMode;
};

/**
 * Connection options for establishing a database connection.
 *
 * Generic type that separates concerns:
 * - Shared config (driver, name, database, connection details)
 * - Driver options (cascade-next driver-specific settings)
 * - Client options (native database client settings)
 * - Model options (default model behaviors)
 *
 * @template TDriverOptions - Driver-specific options (e.g., MongoDriverOptions)
 * @template TClientOptions - Native client options (e.g., MongoClientOptions from mongodb package)
 *
 * @example
 * ```typescript
 * // MongoDB
 * import type { MongoClientOptions } from "mongodb";
 * import type { MongoDriverOptions } from "@warlock.js/cascade";
 *
 * const config: ConnectionOptions<MongoDriverOptions, MongoClientOptions> = {
 *   driver: "mongodb",
 *   database: "myapp",
 *   host: "localhost",
 *   port: 27017,
 *   driverOptions: {
 *     autoGenerateId: true,
 *     counterCollection: "counters",
 *   },
 *   clientOptions: {
 *     minPoolSize: 5,
 *     maxPoolSize: 10,
 *   },
 *   modelOptions: {
 *     randomIncrement: true,
 *     initialId: 1000,
 *   },
 * };
 * ```
 */
export type ConnectionOptions<TDriverOptions = any, TClientOptions = any> = {
  // ============================================================================
  // SHARED CONFIGURATION (Framework-level)
  // ============================================================================

  /**
   * Database driver to use.
   * @default "mongodb"
   */
  driver?: DatabaseDriver;

  /**
   * Unique name for this data source.
   * Used for registration in DataSourceRegistry.
   * @default "default"
   */
  name?: string;

  /**
   * Whether this should be the default data source.
   * @default true
   */
  isDefault?: boolean;

  /**
   * Database name (required).
   */
  database: string;

  // ============================================================================
  // CONNECTION DETAILS (Shared across drivers)
  // ============================================================================

  /**
   * Database connection URI.
   * Alternative to specifying host/port separately.
   *
   * @example "mongodb://localhost:27017/mydb"
   * @example "postgresql://user:pass@localhost:5432/mydb"
   */
  uri?: string;

  /**
   * Database host.
   * @default "localhost"
   */
  host?: string;

  /**
   * Database port.
   * @default 27017 (MongoDB), 5432 (PostgreSQL)
   */
  port?: number;

  /**
   * Database username for authentication.
   */
  username?: string;

  /**
   * Database password for authentication.
   */
  password?: string;

  /**
   * Authentication source database.
   * Typically "admin" for MongoDB.
   */
  authSource?: string;

  // ============================================================================
  // DRIVER OPTIONS (Package-level, driver-specific)
  // ============================================================================

  /**
   * Driver-specific options.
   *
   * For MongoDB: { autoGenerateId, counterCollection, transactionOptions }
   * For PostgreSQL: { schema, ... }
   */
  driverOptions?: TDriverOptions;

  // ============================================================================
  // CLIENT OPTIONS (Native database client library)
  // ============================================================================

  /**
   * Native database client options.
   *
   * For MongoDB: MongoClientOptions from 'mongodb' package
   * For PostgreSQL: PoolConfig from 'pg' package
   */
  clientOptions?: TClientOptions;

  // ============================================================================
  // MODEL OPTIONS (Model defaults)
  // ============================================================================

  /**
   * Default model configuration for all models using this data source.
   *
   * These settings will be applied to models that don't have their own
   * static property overrides.
   *
   * @example
   * ```typescript
   * {
   *   modelOptions: {
   *     randomIncrement: true,
   *     initialId: 1000,
   *     deleteStrategy: "soft",
   *   }
   * }
   * ```
   */
  modelOptions?: ModelDefaultConfig;

  // ============================================================================
  // DATA SOURCE DEFAULTS
  // ============================================================================

  /**
   * Default delete strategy for models using this data source.
   *
   * - MongoDB: Typically `"trash"` (uses RecycleBin collection)
   * - PostgreSQL: Typically `"permanent"` or `"soft"`
   *
   * Can be overridden by model static property or destroy() options.
   *
   * @default undefined (falls back to "permanent")
   */
  defaultDeleteStrategy?: DeleteStrategy;

  /**
   * Default trash table/collection name for "trash" delete strategy.
   *
   * - MongoDB: Typically `"RecycleBin"`
   * - If not set, defaults to `{table}Trash` pattern
   *
   * Can be overridden by Model.trashTable static property.
   *
   * @default undefined (uses {table}Trash pattern)
   */
  defaultTrashTable?: string;
};

/**
 * Connect to a database and register the data source.
 *
 * This is a high-level utility function that simplifies database connection
 * for small to medium projects. It handles driver instantiation, connection,
 * data source creation, and automatic registration.
 *
 * **Supported Drivers:**
 * - `mongodb` (default) - MongoDB driver with optional auto ID generation
 * - `postgres` - PostgreSQL driver (not yet implemented)
 * - `mysql` - MySQL driver (not yet implemented)
 *
 * **Features:**
 * - Automatic driver instantiation based on driver name
 * - Connection establishment and error handling
 * - DataSource creation and registration
 * - Support for MongoDB-specific features (ID generation, transactions)
 *
 * @param options - Connection configuration options
 * @returns A connected and registered DataSource instance
 * @throws {Error} If connection fails or driver is not implemented
 *
 * @example
 * ```typescript
 * // MongoDB with new structure
 * const dataSource = await connectToDatabase({
 *   driver: "mongodb",
 *   database: "myapp",
 *   host: "localhost",
 *   port: 27017,
 *   driverOptions: {
 *     autoGenerateId: true,
 *   },
 *   clientOptions: {
 *     minPoolSize: 5,
 *     maxPoolSize: 10,
 *   },
 *   modelOptions: {
 *     randomIncrement: true,
 *     initialId: 1000,
 *   },
 * });
 * ```
 */
export async function connectToDatabase<TDriverOptions = any, TClientOptions = any>(
  options: ConnectionOptions<TDriverOptions, TClientOptions>,
): Promise<DataSource> {
  // Default values
  const driverType = options.driver ?? "mongodb";
  const dataSourceName = options.name ?? "default";
  const isDefault = options.isDefault ?? true;

  // Create driver based on type
  let driver: DriverContract;

  switch (driverType) {
    case "mongodb": {
      driver = new MongoDbDriver(
        {
          database: options.database,
          uri: options.uri,
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          authSource: options.authSource,
          clientOptions: options.clientOptions as any,
        },
        options.driverOptions as any,
      );
      break;
    }

    case "postgres":
      throw new Error("PostgreSQL driver is not yet implemented. Coming soon!");

    case "mysql":
      throw new Error("MySQL driver is not yet implemented. Coming soon!");

    default:
      throw new Error(
        `Unknown driver: "${driverType}". Supported drivers: mongodb, postgres, mysql`,
      );
  }

  // Create data source
  const dataSource = new DataSource({
    name: dataSourceName,
    driver,
    isDefault,
    defaultDeleteStrategy: options.defaultDeleteStrategy,
    defaultTrashTable: options.defaultTrashTable,
    modelDefaults: options.modelOptions,
  });

  // Register data source
  dataSourceRegistry.register(dataSource);

  // Connect to the database
  try {
    await driver.connect();
  } catch (error) {
    throw new Error(
      `Failed to connect to ${driverType} database: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return dataSource;
}
