/**
 * PostgreSQL Driver
 *
 * Main driver implementation for PostgreSQL database operations.
 * Implements the DriverContract interface to provide a unified API
 * for CRUD operations, transactions, and query building.
 *
 * Uses the `pg` package for database connectivity with connection pooling.
 *
 * @module cascade/drivers/postgres
 */
import type { CreateDatabaseOptions, DriverContract, DriverEventListener, DriverTransactionContract, DropDatabaseOptions, InsertResult, TransactionContext, UpdateOperations, UpdateResult } from "../../contracts/database-driver.contract";
import type { DriverBlueprintContract } from "../../contracts/driver-blueprint.contract";
import type { MigrationDriverContract } from "../../contracts/migration-driver.contract";
import type { QueryBuilderContract } from "../../contracts/query-builder.contract";
import type { SyncAdapterContract } from "../../contracts/sync-adapter.contract";
import { SQLSerializer } from "../../migration/sql-serializer";
import { SqlDatabaseDirtyTracker } from "../../sql-database-dirty-tracker";
import type { ModelDefaults } from "../../types";
import { DatabaseDriver } from "../../utils/connect-to-database";
import { PostgresDialect } from "./postgres-dialect";
import type { PostgresPoolConfig, PostgresQueryResult, PostgresTransactionOptions } from "./types";
/**
 * Lazily loaded pg module types.
 */
type PgPool = import("pg").Pool;
type PgPoolClient = import("pg").PoolClient;
/**
 * PostgreSQL database driver implementing the Cascade DriverContract.
 *
 * Provides connection pooling, CRUD operations, transactions, and
 * integration with Cascade's query builder and migration systems.
 *
 * @example
 * ```typescript
 * const driver = new PostgresDriver({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'secret'
 * });
 *
 * await driver.connect();
 *
 * // Insert a document
 * const result = await driver.insert('users', { name: 'Alice', email: 'alice@example.com' });
 *
 * // Query using the query builder
 * const users = await driver.queryBuilder('users')
 *   .where('name', 'Alice')
 *   .get();
 *
 * await driver.disconnect();
 * ```
 */
export declare class PostgresDriver implements DriverContract {
    private readonly config;
    /**
     * Driver name identifier.
     */
    readonly name: DatabaseDriver;
    /**
     * SQL dialect for PostgreSQL-specific syntax.
     */
    readonly dialect: PostgresDialect;
    /**
     * PostgreSQL driver model defaults.
     *
     * PostgreSQL follows SQL conventions:
     * - snake_case naming for columns (created_at, updated_at, deleted_at)
     * - Native AUTO_INCREMENT for IDs (no manual generation)
     * - Timestamps enabled by default
     * - Permanent delete strategy (hard deletes)
     */
    readonly modelDefaults: Partial<ModelDefaults>;
    /**
     * Connection pool instance.
     */
    private _pool;
    /**
     * Event listeners for driver lifecycle events.
     */
    private readonly _eventListeners;
    /**
     * Whether the driver is currently connected.
     */
    private _isConnected;
    /**
     * Blueprint instance (lazy-loaded).
     */
    private _blueprint;
    /**
     * Migration driver instance (lazy-loaded).
     */
    private _migrationDriver;
    /**
     * Sync adapter instance (lazy-loaded).
     */
    private _syncAdapter;
    /**
     * Create a new PostgreSQL driver instance.
     *
     * @param config - PostgreSQL connection configuration
     */
    constructor(config: PostgresPoolConfig);
    /**
     * Get the connection pool instance.
     *
     * @throws Error if not connected
     */
    get pool(): PgPool;
    /**
     * Get database native client
     */
    getClient<Client = PgPool>(): Client;
    /**
     * Check if the driver is currently connected.
     */
    get isConnected(): boolean;
    /**
     * Get the driver blueprint (information schema).
     */
    get blueprint(): DriverBlueprintContract;
    /**
     * Establish connection to the PostgreSQL database.
     *
     * Creates a connection pool with the configured options.
     * Emits 'connected' event on successful connection.
     */
    connect(): Promise<void>;
    /**
     * Close the database connection pool.
     *
     * Waits for all active queries to complete before closing.
     * Emits 'disconnected' event on successful disconnection.
     */
    disconnect(): Promise<void>;
    /**
     * Register an event listener for driver lifecycle events.
     *
     * @param event - Event name ('connected', 'disconnected', etc.)
     * @param listener - Callback function to invoke
     */
    on(event: string, listener: DriverEventListener): void;
    /**
     * Serialize data for storage in PostgreSQL.
     *
     * Handles Date objects, BigInt, and other JavaScript types
     * that need special handling for PostgreSQL storage.
     *
     * @param data - The data object to serialize
     * @returns Serialized data ready for PostgreSQL
     */
    serialize(data: Record<string, unknown>): Record<string, unknown>;
    /**
     * Get the dirty tracker for this driver.
     */
    getDirtyTracker(data: Record<string, unknown>): SqlDatabaseDirtyTracker;
    /**
     * Deserialize data retrieved from PostgreSQL.
     *
     * Converts PostgreSQL types back to JavaScript equivalents.
     *
     * @param data - The data object from PostgreSQL
     * @returns Deserialized JavaScript object
     */
    deserialize(data: Record<string, unknown>): Record<string, unknown>;
    /**
     * Insert a single row into a table.
     *
     * Uses INSERT ... RETURNING to get the inserted row with generated values.
     *
     * @param table - Target table name
     * @param document - Data to insert
     * @param options - Optional insertion options
     * @returns The inserted document
     */
    insert(table: string, document: Record<string, unknown>, _options?: Record<string, unknown>): Promise<InsertResult>;
    /**
     * Insert multiple rows into a table.
     *
     * Uses a single INSERT statement with multiple value sets for efficiency.
     *
     * @param table - Target table name
     * @param documents - Array of documents to insert
     * @param options - Optional insertion options
     * @returns Array of inserted documents
     */
    insertMany(table: string, documents: Record<string, unknown>[], _options?: Record<string, unknown>): Promise<InsertResult[]>;
    /**
     * Update a single row matching the filter.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param update - Update operations ($set, $unset, $inc)
     * @param options - Optional update options
     * @returns Update result with modified count
     */
    update(table: string, filter: Record<string, unknown>, update: UpdateOperations, _options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Find one and update a single row matching the filter and return the updated row
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param update - Update operations ($set, $unset, $inc)
     * @param options - Optional update options
     * @returns The updated row or null
     */
    findOneAndUpdate<T = unknown>(table: string, filter: Record<string, unknown>, update: UpdateOperations, _options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Update multiple rows matching the filter.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param update - Update operations
     * @param options - Optional update options
     * @returns Update result with modified count
     */
    updateMany(table: string, filter: Record<string, unknown>, update: UpdateOperations, _options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Replace a document matching the filter.
     *
     * Completely replaces the document (not a partial update).
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param document - New document data
     * @param options - Optional options
     * @returns The replaced document or null
     */
    replace<T = unknown>(table: string, filter: Record<string, unknown>, document: Record<string, unknown>, _options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Upsert (insert or update) a single row.
     *
     * Uses PostgreSQL's INSERT ... ON CONFLICT ... DO UPDATE syntax.
     *
     * @param table - Target table name
     * @param filter - Filter conditions to find existing row (used for conflict detection)
     * @param document - Document data to insert or update
     * @param options - Upsert options (conflictColumns for conflict target)
     * @returns The upserted row
     */
    upsert<T = unknown>(table: string, filter: Record<string, unknown>, document: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>;
    /**
     * Find one and delete a single row matching the filter and return the deleted row.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param options - Optional delete options
     * @returns The deleted row or null
     */
    findOneAndDelete<T = unknown>(table: string, filter: Record<string, unknown>, _options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Delete a single row matching the filter.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param options - Optional options
     * @returns Number of deleted rows (0 or 1)
     */
    delete(table: string, filter?: Record<string, unknown>, _options?: Record<string, unknown>): Promise<number>;
    /**
     * Delete multiple rows matching the filter.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param options - Optional options
     * @returns Number of deleted rows
     */
    deleteMany(table: string, filter?: Record<string, unknown>, _options?: Record<string, unknown>): Promise<number>;
    /**
     * Truncate a table (remove all rows).
     *
     * Uses TRUNCATE TABLE for fast deletion with RESTART IDENTITY.
     *
     * @param table - Target table name
     * @param options - Optional options
     * @param options.cascade - If true, automatically truncate all tables with foreign key references (use with caution)
     * @returns Number of deleted rows (always 0 for TRUNCATE)
     */
    truncateTable(table: string, options?: {
        cascade?: boolean;
    }): Promise<number>;
    /**
     * Get a query builder for the specified table.
     *
     * @param table - Target table name
     * @returns Query builder instance
     */
    queryBuilder<T = unknown>(table: string): QueryBuilderContract<T>;
    /**
     * Begin a new database transaction.
     *
     * Acquires a client from the pool and starts a transaction.
     * The client is stored in AsyncLocalStorage for automatic
     * participation by subsequent queries.
     *
     * @param options - Optional transaction options
     * @returns Transaction contract with commit/rollback methods
     */
    beginTransaction(options?: PostgresTransactionOptions): Promise<DriverTransactionContract<PgPoolClient>>;
    /**
     * Execute a function within a transaction scope (recommended pattern).
     *
     * Automatically commits on success, rolls back on any error, and guarantees
     * resource cleanup. This is the recommended way to use transactions.
     *
     * @param fn - Async function to execute within transaction
     * @param options - Transaction options (isolation level, read-only, etc.)
     * @returns The return value of the callback function
     * @throws {Error} If transaction fails or is explicitly rolled back
     */
    transaction<T>(fn: (ctx: TransactionContext) => Promise<T>, options?: Record<string, unknown>): Promise<T>;
    /**
     * Perform an atomic update operation.
     *
     * Builds and executes an UPDATE query for the given filter and operations.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param operations - Update operations
     * @param options - Optional options
     * @returns Update result
     */
    atomic(table: string, filter: Record<string, unknown>, operations: UpdateOperations, _options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Get the sync adapter for bulk denormalized updates.
     *
     * @returns Sync adapter instance
     */
    syncAdapter(): SyncAdapterContract;
    /**
     * Get the migration driver for schema operations.
     *
     * @returns Migration driver instance
     */
    migrationDriver(): MigrationDriverContract;
    /**
     * Return a SQL serializer for this driver's dialect.
     * Used by Migration.toSQL() to convert pending operations to SQL strings.
     */
    getSQLSerializer(): SQLSerializer;
    /**
     * Execute a raw SQL query.
     *
     * Automatically uses the transaction client if one is active.
     *
     * @param sql - SQL query string
     * @param params - Query parameters
     * @returns Query result
     */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PostgresQueryResult<T>>;
    /**
     * Emit an event to all registered listeners.
     *
     * @param event - Event name
     * @param args - Event arguments
     */
    private emit;
    /**
     * Build a simple WHERE clause from a filter object.
     *
     * @param filter - Filter conditions
     * @param startParamIndex - Starting parameter index
     * @returns Object with WHERE clause string and parameters
     */
    private buildWhereClause;
    /**
     * Build an UPDATE query from update operations.
     *
     * @param table - Target table name
     * @param filter - Filter conditions
     * @param update - Update operations
     * @param limit - Optional limit (for single row update)
     * @returns Object with SQL and parameters
     */
    private buildUpdateQuery;
    /**
     * Create a new database.
     *
     * Note: This requires connecting to a system database (like 'postgres')
     * since you cannot create a database while connected to it.
     *
     * @param name - Database name to create
     * @param options - Creation options (encoding, template, etc.)
     * @returns true if created, false if already exists
     */
    createDatabase(name: string, options?: CreateDatabaseOptions): Promise<boolean>;
    /**
     * Drop a database.
     *
     * @param name - Database name to drop
     * @param options - Drop options
     * @returns true if dropped, false if didn't exist
     */
    dropDatabase(name: string, options?: DropDatabaseOptions): Promise<boolean>;
    /**
     * Check if a database exists.
     *
     * @param name - Database name to check
     * @returns true if database exists
     */
    databaseExists(name: string): Promise<boolean>;
    /**
     * List all databases.
     *
     * @returns Array of database names
     */
    listDatabases(): Promise<string[]>;
    /**
     * Drop a table.
     *
     * @param name - Table name to drop
     * @throws Error if table doesn't exist
     */
    dropTable(name: string): Promise<void>;
    /**
     * Drop a table if it exists.
     *
     * @param name - Table name to drop
     */
    dropTableIfExists(name: string): Promise<void>;
    /**
     * Drop all tables in the current database.
     *
     * Uses CASCADE to handle foreign key dependencies.
     * Useful for `migrate:fresh` command.
     */
    dropAllTables(): Promise<void>;
}
export {};
//# sourceMappingURL=postgres-driver.d.ts.map