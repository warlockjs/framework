/**
 * PostgreSQL Migration Driver
 *
 * Implements the MigrationDriverContract for PostgreSQL DDL operations.
 * Provides methods for creating/dropping tables, columns, indexes,
 * and constraints.
 *
 * @module cascade/drivers/postgres
 */
import type { ColumnDefinition, ForeignKeyDefinition, FullTextIndexOptions, GeoIndexOptions, IndexDefinition, MigrationDriverContract, TableIndexInformation, VectorIndexOptions } from "../../contracts/migration-driver.contract";
import type { MigrationDefaults } from "../../types";
import type { PostgresDriver } from "./postgres-driver";
/**
 * PostgreSQL Migration Driver.
 *
 * Handles database schema operations for PostgreSQL including:
 * - Table creation and deletion
 * - Column management
 * - Index creation (B-tree, GIN, GiST, etc.)
 * - Constraint management (foreign keys, unique, etc.)
 *
 * @example
 * ```typescript
 * const migrationDriver = driver.migrationDriver();
 *
 * // Create a table
 * await migrationDriver.createTable('users');
 *
 * // Add columns
 * await migrationDriver.addColumn('users', {
 *   name: 'email',
 *   type: 'string',
 *   length: 255,
 *   nullable: false
 * });
 *
 * // Create unique index
 * await migrationDriver.createUniqueIndex('users', ['email']);
 * ```
 */
export declare class PostgresMigrationDriver implements MigrationDriverContract {
    readonly driver: PostgresDriver;
    /**
     * Active transaction client (if any).
     */
    private get transactionClient();
    /**
     * Create a new migration driver.
     *
     * @param driver - The PostgreSQL driver instance
     */
    constructor(driver: PostgresDriver);
    /**
     * Create a new table with a default id column.
     *
     * @param table - Table name
     */
    createTable(table: string): Promise<void>;
    /**
     * Create table if it doesn't exist.
     *
     * @param table - Table name
     */
    createTableIfNotExists(table: string): Promise<void>;
    /**
     * Drop an existing table.
     *
     * @param table - Table name
     */
    dropTable(table: string): Promise<void>;
    /**
     * Drop table if it exists.
     *
     * @param table - Table name
     */
    dropTableIfExists(table: string): Promise<void>;
    /**
     * Rename a table.
     *
     * @param from - Current table name
     * @param to - New table name
     */
    renameTable(from: string, to: string): Promise<void>;
    /**
     * Truncate a table — remove all rows efficiently.
     *
     * @param table - Table name
     */
    truncateTable(table: string): Promise<void>;
    /**
     * Check if a table exists.
     *
     * @param table - Table name
     * @returns Whether the table exists
     */
    tableExists(table: string): Promise<boolean>;
    /**
     * List all columns in a table.
     *
     * @param table - Table name
     * @returns Array of column definitions
     */
    listColumns(table: string): Promise<ColumnDefinition[]>;
    /**
     * List all tables in the current database.
     *
     * @returns Array of table names
     */
    listTables(): Promise<string[]>;
    /**
     * Ensure the migrations tracking table exists.
     *
     * Creates the table with proper schema if it doesn't exist.
     *
     * @param tableName - Name of the migrations table
     */
    ensureMigrationsTable(tableName: string): Promise<void>;
    /**
     * Add a column to an existing table.
     *
     * @param table - Table name
     * @param column - Column definition
     */
    addColumn(table: string, column: ColumnDefinition): Promise<void>;
    /**
     * Drop a column from a table.
     *
     * @param table - Table name
     * @param column - Column name
     */
    dropColumn(table: string, column: string): Promise<void>;
    /**
     * Drop multiple columns from a table.
     *
     * @param table - Table name
     * @param columns - Column names
     */
    dropColumns(table: string, columns: string[]): Promise<void>;
    /**
     * Rename a column.
     *
     * @param table - Table name
     * @param from - Current column name
     * @param to - New column name
     */
    renameColumn(table: string, from: string, to: string): Promise<void>;
    /**
     * Modify an existing column.
     *
     * @param table - Table name
     * @param column - New column definition
     */
    modifyColumn(table: string, column: ColumnDefinition): Promise<void>;
    /**
     * Create standard timestamp columns (created_at, updated_at).
     *
     * PostgreSQL implementation creates TIMESTAMPTZ columns with NOW() defaults.
     *
     * @param table - Table name
     */
    createTimestampColumns(table: string): Promise<void>;
    /**
     * Create an index on one or more columns.
     *
     * Supports:
     * - Regular column indexes
     * - Expression-based indexes (e.g., `lower(email)`)
     * - Covering indexes (INCLUDE clause)
     * - Concurrent index creation (CONCURRENTLY keyword)
     *
     * @param table - Table name
     * @param index - Index definition
     */
    createIndex(table: string, index: IndexDefinition): Promise<void>;
    /**
     * Drop an index.
     *
     * @param table - Table name
     * @param indexNameOrColumns - Index name or columns
     */
    dropIndex(table: string, indexNameOrColumns: string | string[]): Promise<void>;
    /**
     * Create a unique index.
     *
     * @param table - Table name
     * @param columns - Columns to include
     * @param name - Optional index name
     */
    createUniqueIndex(table: string, columns: string[], name?: string): Promise<void>;
    /**
     * Drop a unique index.
     *
     * @param table - Table name
     * @param columns - Columns in the index
     */
    dropUniqueIndex(table: string, columns: string[]): Promise<void>;
    /**
     * Create a full-text search index using GIN.
     *
     * @param table - Table name
     * @param columns - Columns to index
     * @param options - Full-text options
     */
    createFullTextIndex(table: string, columns: string[], options?: FullTextIndexOptions): Promise<void>;
    /**
     * Drop a full-text search index.
     *
     * @param table - Table name
     * @param name - Index name
     */
    dropFullTextIndex(table: string, name: string): Promise<void>;
    /**
     * Create a geo-spatial index using GiST.
     *
     * @param table - Table name
     * @param column - Geo column
     * @param options - Geo index options
     */
    createGeoIndex(table: string, column: string, options?: GeoIndexOptions): Promise<void>;
    /**
     * Drop a geo-spatial index.
     *
     * @param table - Table name
     * @param column - Geo column
     */
    dropGeoIndex(table: string, column: string): Promise<void>;
    /**
     * Create a vector search index (requires pgvector extension).
     *
     * @param table - Table name
     * @param column - Vector column
     * @param options - Vector index options
     */
    createVectorIndex(table: string, column: string, options: VectorIndexOptions): Promise<void>;
    /**
     * Drop a vector search index.
     *
     * @param table - Table name
     * @param column - Vector column
     */
    dropVectorIndex(table: string, column: string): Promise<void>;
    /**
     * Create a TTL index (not natively supported in PostgreSQL).
     *
     * Note: PostgreSQL doesn't have native TTL indexes like MongoDB.
     * This creates a partial index and requires a scheduled job for cleanup.
     *
     * @param table - Table name
     * @param column - Date column
     * @param expireAfterSeconds - Expiration time in seconds
     */
    createTTLIndex(table: string, column: string, expireAfterSeconds: number): Promise<void>;
    /**
     * Drop a TTL index.
     *
     * @param table - Table name
     * @param column - Column with TTL index
     */
    dropTTLIndex(table: string, column: string): Promise<void>;
    /**
     * List all indexes on a table.
     *
     * @param table - Table name
     * @returns Array of index metadata
     */
    listIndexes(table: string): Promise<TableIndexInformation[]>;
    /**
     * Check if a PostgreSQL extension is available on the database server.
     *
     * @param extension - Extension name (e.g., "vector")
     */
    isExtensionAvailable(extension: string): Promise<boolean>;
    /**
     * Get the official documentation or installation URL for a PostgreSQL extension.
     *
     * @param extension - Extension name
     */
    getExtensionDocsUrl(extension: string): string | undefined;
    /**
     * Add a foreign key constraint.
     *
     * @param table - Table name
     * @param foreignKey - Foreign key definition
     */
    addForeignKey(table: string, foreignKey: ForeignKeyDefinition): Promise<void>;
    /**
     * Drop a foreign key constraint.
     *
     * @param table - Table name
     * @param name - Constraint name
     */
    dropForeignKey(table: string, name: string): Promise<void>;
    /**
     * Add a primary key constraint.
     *
     * @param table - Table name
     * @param columns - Primary key columns
     */
    addPrimaryKey(table: string, columns: string[]): Promise<void>;
    /**
     * Drop the primary key constraint.
     *
     * @param table - Table name
     */
    dropPrimaryKey(table: string): Promise<void>;
    /**
     * Add a CHECK constraint.
     *
     * @param table - Table name
     * @param name - Constraint name
     * @param expression - SQL CHECK expression
     */
    addCheck(table: string, name: string, expression: string): Promise<void>;
    /**
     * Drop a CHECK constraint.
     *
     * @param table - Table name
     * @param name - Constraint name
     */
    dropCheck(table: string, name: string): Promise<void>;
    /**
     * Set schema validation (no-op for PostgreSQL).
     *
     * PostgreSQL uses column constraints instead.
     */
    setSchemaValidation(_table: string, _schema: object): Promise<void>;
    /**
     * Remove schema validation (no-op for PostgreSQL).
     */
    removeSchemaValidation(_table: string): Promise<void>;
    /**
     * Begin a transaction.
     */
    beginTransaction(): Promise<void>;
    /**
     * Commit the current transaction.
     */
    commit(): Promise<void>;
    /**
     * Rollback the current transaction.
     */
    rollback(): Promise<void>;
    /**
     * Whether transactions are supported.
     */
    supportsTransactions(): boolean;
    /**
     * Get the default transactional behavior for PostgreSQL.
     *
     * PostgreSQL supports transactional DDL operations, so migrations
     * are wrapped in transactions by default for atomicity and safety.
     *
     * @returns true (PostgreSQL DDL is transactional)
     */
    getDefaultTransactional(): boolean;
    /**
     * Get the default UUID generation expression for PostgreSQL.
     *
     * Resolution order:
     * 1. `migrationDefaults.uuidExpression` → raw expression (escape hatch)
     * 2. `migrationDefaults.uuidStrategy` → mapped to PG function
     * 3. Fallback → `gen_random_uuid()` (v4, PG 13+)
     *
     * @param migrationDefaults - Optional overrides from DataSource config
     * @returns PostgreSQL SQL expression for UUID generation
     *
     * @example
     * ```typescript
     * driver.getUuidDefault(); // "gen_random_uuid()"
     * driver.getUuidDefault({ uuidStrategy: "v7" }); // "uuidv7()"
     * driver.getUuidDefault({ uuidExpression: "uuid_generate_v1mc()" }); // "uuid_generate_v1mc()"
     * ```
     */
    getUuidDefault(migrationDefaults?: MigrationDefaults): string;
    /**
     * Execute raw operations with direct driver access.
     *
     * @param callback - Callback receiving the driver
     */
    raw<T>(callback: (connection: unknown) => Promise<T>): Promise<T>;
    /**
     * Execute a SQL statement.
     *
     * @param sql - SQL to execute
     * @param params - Query parameters
     */
    private execute;
    /**
     * Map foreign key action to PostgreSQL syntax.
     */
    private mapForeignKeyAction;
    /**
     * Map PostgreSQL data type to ColumnType.
     */
    private mapPostgresTypeToColumnType;
}
//# sourceMappingURL=postgres-migration-driver.d.ts.map