import type { ClientSession, Db, MongoClient, MongoClientOptions } from "mongodb";
import type { DriverBlueprintContract, DriverContract, DriverEvent, DriverEventListener, DriverTransactionContract, IdGeneratorContract, InsertResult, MigrationDriverContract, QueryBuilderContract, SyncAdapterContract, TransactionContext, UpdateOperations, UpdateResult } from "../../contracts";
import { DatabaseDirtyTracker } from "../../database-dirty-tracker";
import { type SQLSerializer } from "../../migration/sql-serializer";
import type { ModelDefaults } from "../../types";
import type { MongoDriverOptions } from "./types";
export declare function isMongoDBDriverLoaded(): boolean | null;
/**
 * MongoDB driver implementation that fulfils the Cascade driver contract.
 *
 * It encapsulates the native Mongo client, exposes lifecycle events, and
 * provides helpers for CRUD, transactions, atomic updates, and sync adapters.
 */
export declare class MongoDbDriver implements DriverContract {
    private readonly config;
    private readonly driverOptions?;
    private readonly events;
    client?: MongoClient;
    database?: Db;
    private connected;
    private syncAdapterInstance?;
    private migrationDriverInstance?;
    private readonly transactionOptions;
    private idGeneratorInstance?;
    private _blueprint?;
    get blueprint(): DriverBlueprintContract;
    /**
     * The name of this driver.
     */
    readonly name = "mongodb";
    /**
     * Current database name
     */
    protected _databaseName?: string;
    /**
     * MongoDB driver model defaults.
     *
     * MongoDB follows NoSQL conventions:
     * - camelCase naming for fields (createdAt, updatedAt, deletedAt)
     * - Manual ID generation (auto-increment id field separate from _id)
     * - Timestamps enabled by default
     * - Trash delete strategy with per-collection trash tables
     */
    readonly modelDefaults: Partial<ModelDefaults>;
    /**
     * Create a new MongoDB driver using the supplied connection options.
     *
     * @param config - Connection configuration
     * @param driverOptions - Driver-specific options
     */
    constructor(config: {
        database: string;
        uri?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        authSource?: string;
        logging?: boolean;
        clientOptions?: MongoClientOptions;
    }, driverOptions?: MongoDriverOptions | undefined);
    /**
     * Get data base name
     */
    get databaseName(): string | undefined;
    /**
     * Resolve database name either from config or uri
     */
    private resolveDatabaseName;
    /**
     * Indicates whether the driver currently maintains an active connection.
     */
    get isConnected(): boolean;
    /**
     * Get the MongoDB database instance.
     *
     * @returns The MongoDB Db instance
     * @throws {Error} If not connected
     *
     * @example
     * ```typescript
     * const db = driver.getDatabase();
     * const collection = db.collection("users");
     * ```
     */
    getDatabase(): Db;
    /**
     * Get the ID generator instance for this driver.
     *
     * Creates a MongoIdGenerator on first access if autoGenerateId is enabled.
     *
     * @returns The ID generator instance, or undefined if disabled
     *
     * @example
     * ```typescript
     * const idGenerator = driver.getIdGenerator();
     * if (idGenerator) {
     *   const id = await idGenerator.generateNextId({ table: "users" });
     * }
     * ```
     */
    getIdGenerator(): IdGeneratorContract | undefined;
    /**
     * Establish a MongoDB connection using the configured options.
     * Throws if the connection attempt fails.
     */
    connect(): Promise<void>;
    /**
     * Close the underlying MongoDB connection.
     */
    disconnect(): Promise<void>;
    /**
     * Subscribe to driver lifecycle events.
     */
    on(event: DriverEvent, listener: DriverEventListener): void;
    /**
     * Insert a single document into the given collection.
     */
    insert(table: string, document: Record<string, unknown>, options?: Record<string, unknown>): Promise<InsertResult>;
    /**
     * Insert multiple documents into the given collection.
     */
    insertMany(table: string, documents: Record<string, unknown>[], options?: Record<string, unknown>): Promise<InsertResult[]>;
    /**
     * Update a single document that matches the provided filter.
     */
    update(table: string, filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Replace a single document that matches the provided filter.
     */
    replace<T = unknown>(table: string, filter: Record<string, unknown>, document: Record<string, unknown>, options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Find one and update a single document that matches the provided filter and return the updated document
     */
    findOneAndUpdate<T = unknown>(table: string, filter: Record<string, unknown>, update: UpdateOperations, options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Upsert (insert or update) a single document.
     *
     * Uses MongoDB's findOneAndUpdate with upsert option.
     *
     * @param table - Target collection name
     * @param filter - Filter conditions to find existing document
     * @param document - Document data to insert or update
     * @param options - Optional upsert options
     * @returns The upserted document
     */
    upsert<T = unknown>(table: string, filter: Record<string, unknown>, document: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>;
    /**
     * Find one and delete a single document that matches the provided filter and return the deleted document.
     *
     * @param table - Target collection name
     * @param filter - Filter conditions
     * @param options - Optional delete options
     * @returns The deleted document or null if not found
     */
    findOneAndDelete<T = unknown>(table: string, filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<T | null>;
    /**
     * Update multiple documents that match the provided filter.
     */
    updateMany(table: string, filter: Record<string, unknown>, update: UpdateOperations, options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Delete a single document that matches the provided filter.
     */
    delete(table: string, filter?: Record<string, unknown>, options?: Record<string, unknown>): Promise<number>;
    /**
     * Delete documents that match the provided filter.
     */
    deleteMany(table: string, filter?: Record<string, unknown>, options?: Record<string, unknown>): Promise<number>;
    /**
     * Remove all records from a collection.
     *
     * This uses deleteMany with an empty filter to remove all documents.
     * For very large collections, consider using the migration driver's
     * dropTable + createTable approach for better performance.
     */
    truncateTable(table: string, options?: Record<string, unknown>): Promise<number>;
    /**
     * Serialize the given data
     */
    serialize(data: Record<string, unknown>): Record<string, unknown>;
    /**
     * Get the dirty tracker for this driver.
     */
    getDirtyTracker(data: Record<string, unknown>): DatabaseDirtyTracker;
    /**
     * Deserialize the given data
     */
    deserialize(data: Record<string, unknown>): Record<string, unknown>;
    /**
     * Provide a Mongo-backed query builder instance for the given collection.
     */
    queryBuilder<T = unknown>(table: string): QueryBuilderContract<T>;
    /**
     * Begin a MongoDB transaction, returning commit/rollback helpers.
     */
    beginTransaction(): Promise<DriverTransactionContract<ClientSession>>;
    /**
     * Execute a function within a transaction scope (recommended pattern).
     *
     * Automatically commits on success, rolls back on any error, and guarantees
     * resource cleanup. This is the recommended way to use transactions.
     *
     * **MongoDB Requirements:**
     * - Requires MongoDB 4.0+ with replica set or sharded cluster
     * - Standalone MongoDB instances do not support transactions
     *
     * @param fn - Async function to execute within transaction
     * @param options - Transaction options (read preference, write concern, etc.)
     * @returns The return value of the callback function
     * @throws {Error} If transaction fails, is explicitly rolled back, or replica set not configured
     */
    transaction<T>(fn: (ctx: TransactionContext) => Promise<T>, options?: Record<string, unknown>): Promise<T>;
    /**
     * Execute atomic operations (typically $inc/$set style updates) against documents.
     *
     * Uses `updateMany` so callers can atomically modify any set of documents.
     */
    atomic(table: string, filter: Record<string, unknown>, operations: Record<string, unknown>, options?: Record<string, unknown>): Promise<UpdateResult>;
    /**
     * Lazily create (and cache) the Mongo sync adapter.
     * The adapter uses this driver instance to ensure all operations
     * participate in active transactions via the session context.
     */
    syncAdapter(): SyncAdapterContract;
    /**
     * Lazily create (and cache) the Mongo migration driver.
     * The migration driver handles schema operations like indexes, collections, etc.
     */
    migrationDriver(): MigrationDriverContract;
    /**
     * Expose the underlying Mongo client for advanced consumers.
     */
    getClient<Client = MongoClient>(): Client;
    /**
     * Retrieve the active Mongo client, throwing if the driver is disconnected.
     */
    private getClientInstance;
    /**
     * Retrieve the active Mongo database, throwing if the driver is disconnected.
     * @private
     */
    private getDatabaseInstance;
    /**
     * Resolve the Mongo connection string based on provided options.
     */
    private resolveUri;
    /**
     * Build the Mongo client options derived from the driver configuration.
     */
    private buildClientOptions;
    /**
     * Emit a driver lifecycle event.
     */
    private emit;
    /**
     * Ensure MongoDB is running as a replica set (required for transactions).
     *
     * @throws {Error} If MongoDB is running as a standalone instance
     */
    private ensureReplicaSetAvailable;
    /**
     * Attach the active transaction session (when available) to Mongo options.
     */
    private withSession;
    /**
     * Return a SQL serializer for this driver's dialect.
     * Not supported for MongoDB.
     */
    getSQLSerializer(): SQLSerializer;
    /**
     * Execute a raw SQL query.
     * Not supported for MongoDB.
     */
    query<T = unknown>(_sql: string, _params?: unknown[]): Promise<any>;
    /**
     * Create a new database.
     *
     * In MongoDB, databases are created automatically when data is first written.
     * This method creates an empty collection to ensure the database exists.
     *
     * @param name - Database name to create
     * @returns true if created, false if already exists
     */
    createDatabase(name: string): Promise<boolean>;
    /**
     * Drop a database.
     *
     * @param name - Database name to drop
     * @returns true if dropped, false if didn't exist
     */
    dropDatabase(name: string): Promise<boolean>;
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
     * Drop a collection.
     *
     * @param name - Collection name to drop
     * @throws Error if collection doesn't exist
     */
    dropTable(name: string): Promise<void>;
    /**
     * Drop a collection if it exists.
     *
     * @param name - Collection name to drop
     */
    dropTableIfExists(name: string): Promise<void>;
    /**
     * Drop all collections in the current database.
     *
     * Useful for `migrate:fresh` command.
     */
    dropAllTables(): Promise<void>;
}
//# sourceMappingURL=mongodb-driver.d.ts.map