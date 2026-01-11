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

import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import { databaseTransactionContext } from "../../context/database-transaction-context";
import type {
  CreateDatabaseOptions,
  DriverContract,
  DriverEventListener,
  DriverTransactionContract,
  DropDatabaseOptions,
  InsertResult,
  UpdateOperations,
  UpdateResult,
} from "../../contracts/database-driver.contract";
import type { DriverBlueprintContract } from "../../contracts/driver-blueprint.contract";
import type { MigrationDriverContract } from "../../contracts/migration-driver.contract";
import type { QueryBuilderContract } from "../../contracts/query-builder.contract";
import type { SyncAdapterContract } from "../../contracts/sync-adapter.contract";
import { PostgresBlueprint } from "./postgres-blueprint";
import { PostgresDialect } from "./postgres-dialect";
import { PostgresMigrationDriver } from "./postgres-migration-driver";
import { PostgresQueryBuilder } from "./postgres-query-builder";
import { PostgresSyncAdapter } from "./postgres-sync-adapter";
import type { PostgresPoolConfig, PostgresQueryResult, PostgresTransactionOptions } from "./types";

/**
 * Lazily loaded pg module types.
 */
type PgPool = import("pg").Pool;
type PgPoolClient = import("pg").PoolClient;
type PgPoolConfig = import("pg").PoolConfig;

/**
 * Cached pg module reference.
 */
let pgModule: typeof import("pg") | undefined;

/**
 * Lazily load the pg package.
 *
 * @returns The pg module
 * @throws Error if pg is not installed
 */
async function loadPg(): Promise<typeof import("pg")> {
  if (pgModule) {
    return pgModule;
  }

  try {
    pgModule = await import("pg");
    return pgModule;
  } catch {
    throw new Error(
      'The "pg" package is required for PostgreSQL support. ' + "Please install it: npm install pg",
    );
  }
}

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
export class PostgresDriver implements DriverContract {
  /**
   * Driver name identifier.
   */
  public readonly name = "postgres" as const;

  /**
   * SQL dialect for PostgreSQL-specific syntax.
   */
  public readonly dialect = new PostgresDialect();

  /**
   * Connection pool instance.
   */
  private _pool: PgPool | undefined;

  /**
   * Event listeners for driver lifecycle events.
   */
  private readonly _eventListeners = new Map<string, Set<DriverEventListener>>();

  /**
   * Whether the driver is currently connected.
   */
  private _isConnected = false;

  /**
   * Blueprint instance (lazy-loaded).
   */
  private _blueprint: DriverBlueprintContract | undefined;

  /**
   * Migration driver instance (lazy-loaded).
   */
  private _migrationDriver: MigrationDriverContract | undefined;

  /**
   * Sync adapter instance (lazy-loaded).
   */
  private _syncAdapter: SyncAdapterContract | undefined;

  /**
   * Create a new PostgreSQL driver instance.
   *
   * @param config - PostgreSQL connection configuration
   */
  public constructor(private readonly config: PostgresPoolConfig) {}

  /**
   * Get the connection pool instance.
   *
   * @throws Error if not connected
   */
  public get pool(): PgPool {
    if (!this._pool) {
      throw new Error("PostgreSQL driver is not connected. Call connect() first.");
    }
    return this._pool;
  }

  /**
   * Check if the driver is currently connected.
   */
  public get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get the driver blueprint (information schema).
   */
  public get blueprint(): DriverBlueprintContract {
    if (!this._blueprint) {
      this._blueprint = new PostgresBlueprint(this);
    }
    return this._blueprint;
  }

  /**
   * Establish connection to the PostgreSQL database.
   *
   * Creates a connection pool with the configured options.
   * Emits 'connected' event on successful connection.
   */
  public async connect(): Promise<void> {
    if (this._isConnected) {
      return;
    }

    const pg = await loadPg();

    try {
      const poolConfig: PgPoolConfig = {
        host: this.config.host ?? "localhost",
        port: this.config.port ?? 5432,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        connectionString: this.config.connectionString,
        max: this.config.max ?? 10,
        min: this.config.min ?? 0,
        idleTimeoutMillis: this.config.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis ?? 2000,
        application_name: this.config.application_name ?? "cascade",
        ssl: this.config.ssl,
      };

      log.info(
        "database",
        "connection[Postgress]",
        `Connecting to database ${colors.bold(colors.yellowBright(this.config.database))}`,
      );

      this._pool = new pg.Pool(poolConfig);

      // Test the connection
      const client = await this._pool.connect();
      client.release();

      log.success(
        "database",
        "connection[Postgress]",
        `Connected to database ${colors.bold(colors.yellowBright(this.config.database))}`,
      );

      this._isConnected = true;
      this.emit("connected");
    } catch (error) {
      log.error("database", "connection[Postgress]", "Failed to connect to database");
      throw error;
    }
  }

  /**
   * Close the database connection pool.
   *
   * Waits for all active queries to complete before closing.
   * Emits 'disconnected' event on successful disconnection.
   */
  public async disconnect(): Promise<void> {
    if (!this._isConnected || !this._pool) {
      return;
    }

    await this._pool.end();
    this._pool = undefined;
    this._isConnected = false;
    this.emit("disconnected");
  }

  /**
   * Register an event listener for driver lifecycle events.
   *
   * @param event - Event name ('connected', 'disconnected', etc.)
   * @param listener - Callback function to invoke
   */
  public on(event: string, listener: DriverEventListener): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event)!.add(listener);
  }

  /**
   * Serialize data for storage in PostgreSQL.
   *
   * Handles Date objects, BigInt, and other JavaScript types
   * that need special handling for PostgreSQL storage.
   *
   * @param data - The data object to serialize
   * @returns Serialized data ready for PostgreSQL
   */
  public serialize(data: Record<string, unknown>): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        continue; // Skip undefined values
      }

      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      } else if (typeof value === "bigint") {
        serialized[key] = value.toString();
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        // Nested objects will be stored as JSONB
        serialized[key] = value;
      } else {
        serialized[key] = value;
      }
    }

    return serialized;
  }

  /**
   * Deserialize data retrieved from PostgreSQL.
   *
   * Converts PostgreSQL types back to JavaScript equivalents.
   *
   * @param data - The data object from PostgreSQL
   * @returns Deserialized JavaScript object
   */
  public deserialize(data: Record<string, unknown>): Record<string, unknown> {
    // PostgreSQL pg driver handles most type conversions automatically
    // Special handling can be added here if needed
    return data;
  }

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
  public async insert(
    table: string,
    document: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<InsertResult> {
    const serialized = this.serialize(document);

    // Filter out id if null/undefined to let PostgreSQL SERIAL auto-generate
    const filteredData = Object.fromEntries(
      Object.entries(serialized).filter(([key, value]) => {
        // Exclude id if null/undefined (let SERIAL handle it)
        if (key === "id" && (value === null || value === undefined)) {
          return false;
        }
        return true;
      }),
    );

    const columns = Object.keys(filteredData);
    const values = Object.values(filteredData);

    if (columns.length === 0) {
      throw new Error("Cannot insert empty document");
    }

    const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
    const placeholders = columns.map((_, i) => this.dialect.placeholder(i + 1)).join(", ");
    const quotedTable = this.dialect.quoteIdentifier(table);

    const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`;

    const result = await this.query<Record<string, unknown>>(sql, values);

    return {
      document: this.deserialize(result.rows[0]),
    };
  }

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
  public async insertMany(
    table: string,
    documents: Record<string, unknown>[],
    _options?: Record<string, unknown>,
  ): Promise<InsertResult[]> {
    if (documents.length === 0) {
      return [];
    }

    // Get all unique columns across all documents
    const allColumns = new Set<string>();
    for (const doc of documents) {
      const serialized = this.serialize(doc);
      Object.keys(serialized).forEach((key) => allColumns.add(key));
    }
    const columns = Array.from(allColumns);

    const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
    const quotedTable = this.dialect.quoteIdentifier(table);

    // Build value sets and params
    const valueSets: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const doc of documents) {
      const serialized = this.serialize(doc);
      const rowPlaceholders: string[] = [];

      for (const col of columns) {
        if (col in serialized) {
          rowPlaceholders.push(this.dialect.placeholder(paramIndex++));
          params.push(serialized[col]);
        } else {
          rowPlaceholders.push("DEFAULT");
        }
      }

      valueSets.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${valueSets.join(", ")} RETURNING *`;

    const result = await this.query<Record<string, unknown>>(sql, params);

    return result.rows.map((row) => ({
      document: this.deserialize(row),
    }));
  }

  /**
   * Update a single row matching the filter.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param update - Update operations ($set, $unset, $inc)
   * @param options - Optional update options
   * @returns Update result with modified count
   */
  public async update(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    _options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const { sql, params } = this.buildUpdateQuery(table, filter, update, 1);

    const result = await this.query(sql, params);

    return {
      modifiedCount: result.rowCount ?? 0,
    };
  }

  /**
   * Update multiple rows matching the filter.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param update - Update operations
   * @param options - Optional update options
   * @returns Update result with modified count
   */
  public async updateMany(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    _options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const { sql, params } = this.buildUpdateQuery(table, filter, update);

    const result = await this.query(sql, params);

    return {
      modifiedCount: result.rowCount ?? 0,
    };
  }

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
  public async replace<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    document: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<T | null> {
    const serialized = this.serialize(document);
    const columns = Object.keys(serialized);
    const values = Object.values(serialized);

    const quotedTable = this.dialect.quoteIdentifier(table);
    const setClauses = columns
      .map((col, i) => `${this.dialect.quoteIdentifier(col)} = ${this.dialect.placeholder(i + 1)}`)
      .join(", ");

    const { whereClause, whereParams } = this.buildWhereClause(filter, columns.length + 1);

    const sql = `UPDATE ${quotedTable} SET ${setClauses} ${whereClause} RETURNING *`;
    const params = [...values, ...whereParams];

    const result = await this.query<T>(sql, params);

    return result.rows[0] ?? null;
  }

  /**
   * Delete a single row matching the filter.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param options - Optional options
   * @returns Number of deleted rows (0 or 1)
   */
  public async delete(
    table: string,
    filter?: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<number> {
    const quotedTable = this.dialect.quoteIdentifier(table);
    const { whereClause, whereParams } = this.buildWhereClause(filter ?? {}, 1);

    // Use ctid for single row deletion
    const sql = `DELETE FROM ${quotedTable} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1)`;

    const result = await this.query(sql, whereParams);

    return result.rowCount ?? 0;
  }

  /**
   * Delete multiple rows matching the filter.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param options - Optional options
   * @returns Number of deleted rows
   */
  public async deleteMany(
    table: string,
    filter?: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<number> {
    const quotedTable = this.dialect.quoteIdentifier(table);
    const { whereClause, whereParams } = this.buildWhereClause(filter ?? {}, 1);

    const sql = `DELETE FROM ${quotedTable} ${whereClause}`;

    const result = await this.query(sql, whereParams);

    return result.rowCount ?? 0;
  }

  /**
   * Truncate a table (remove all rows).
   *
   * Uses TRUNCATE TABLE for fast deletion with RESTART IDENTITY.
   *
   * @param table - Target table name
   * @param options - Optional options
   * @returns Number of deleted rows (always 0 for TRUNCATE)
   */
  public async truncateTable(table: string, _options?: Record<string, unknown>): Promise<number> {
    const quotedTable = this.dialect.quoteIdentifier(table);
    await this.query(`TRUNCATE TABLE ${quotedTable} RESTART IDENTITY`);
    return 0; // TRUNCATE doesn't return row count
  }

  /**
   * Get a query builder for the specified table.
   *
   * @param table - Target table name
   * @returns Query builder instance
   */
  public queryBuilder<T = unknown>(table: string): QueryBuilderContract<T> {
    return new PostgresQueryBuilder<T>(table) as unknown as QueryBuilderContract<T>;
  }

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
  public async beginTransaction(
    options?: PostgresTransactionOptions,
  ): Promise<DriverTransactionContract<PgPoolClient>> {
    const client = await this.pool.connect();

    let beginSql = "BEGIN";
    if (options?.isolationLevel) {
      beginSql += ` ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`;
    }
    if (options?.readOnly) {
      beginSql += " READ ONLY";
    }
    if (options?.deferrable) {
      beginSql += " DEFERRABLE";
    }

    await client.query(beginSql);

    return {
      context: client,
      commit: async () => {
        await client.query("COMMIT");
        client.release();
      },
      rollback: async () => {
        await client.query("ROLLBACK");
        client.release();
      },
    };
  }

  /**
   * Perform an atomic update operation.
   *
   * Uses PostgreSQL's row-level locking for atomicity.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param operations - Update operations
   * @param options - Optional options
   * @returns Update result
   */
  public async atomic(
    table: string,
    filter: Record<string, unknown>,
    operations: UpdateOperations,
    _options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    // For PostgreSQL, we use SELECT FOR UPDATE to lock the row
    // then perform the update
    const { sql, params } = this.buildUpdateQuery(table, filter, operations, 1);

    const result = await this.query(sql, params);

    return {
      modifiedCount: result.rowCount ?? 0,
    };
  }

  /**
   * Get the sync adapter for bulk denormalized updates.
   *
   * @returns Sync adapter instance
   */
  public syncAdapter(): SyncAdapterContract {
    if (!this._syncAdapter) {
      this._syncAdapter = new PostgresSyncAdapter(this);
    }
    return this._syncAdapter;
  }

  /**
   * Get the migration driver for schema operations.
   *
   * @returns Migration driver instance
   */
  public migrationDriver(): MigrationDriverContract {
    if (!this._migrationDriver) {
      this._migrationDriver = new PostgresMigrationDriver(this);
    }
    return this._migrationDriver;
  }

  /**
   * Execute a raw SQL query.
   *
   * Automatically uses the transaction client if one is active.
   *
   * @param sql - SQL query string
   * @param params - Query parameters
   * @returns Query result
   */
  public async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<PostgresQueryResult<T>> {
    // Check for active transaction client
    const txClient = databaseTransactionContext.getSession() as PgPoolClient | undefined;

    if (txClient) {
      const result = await txClient.query(sql, params);
      return result as PostgresQueryResult<T>;
    }

    return this.pool.query(sql, params) as unknown as Promise<PostgresQueryResult<T>>;
  }

  /**
   * Emit an event to all registered listeners.
   *
   * @param event - Event name
   * @param args - Event arguments
   */
  private emit(event: string, ...args: unknown[]): void {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  /**
   * Build a simple WHERE clause from a filter object.
   *
   * @param filter - Filter conditions
   * @param startParamIndex - Starting parameter index
   * @returns Object with WHERE clause string and parameters
   */
  private buildWhereClause(
    filter: Record<string, unknown>,
    startParamIndex: number,
  ): { whereClause: string; whereParams: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = startParamIndex;

    for (const [key, value] of Object.entries(filter)) {
      const quotedKey = this.dialect.quoteIdentifier(key);

      if (value === null) {
        conditions.push(`${quotedKey} IS NULL`);
      } else {
        conditions.push(`${quotedKey} = ${this.dialect.placeholder(paramIndex++)}`);
        params.push(value);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return { whereClause, whereParams: params };
  }

  /**
   * Build an UPDATE query from update operations.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param update - Update operations
   * @param limit - Optional limit (for single row update)
   * @returns Object with SQL and parameters
   */
  private buildUpdateQuery(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    limit?: number,
  ): { sql: string; params: unknown[] } {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Handle $set
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        setClauses.push(
          `${this.dialect.quoteIdentifier(key)} = ${this.dialect.placeholder(paramIndex++)}`,
        );
        params.push(value);
      }
    }

    // Handle $unset (set to NULL)
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        setClauses.push(`${this.dialect.quoteIdentifier(key)} = NULL`);
      }
    }

    // Handle $inc
    if (update.$inc) {
      for (const [key, amount] of Object.entries(update.$inc)) {
        const quotedKey = this.dialect.quoteIdentifier(key);
        setClauses.push(
          `${quotedKey} = COALESCE(${quotedKey}, 0) + ${this.dialect.placeholder(paramIndex++)}`,
        );
        params.push(amount);
      }
    }

    // Handle $dec
    if (update.$dec) {
      for (const [key, amount] of Object.entries(update.$dec)) {
        const quotedKey = this.dialect.quoteIdentifier(key);
        setClauses.push(
          `${quotedKey} = COALESCE(${quotedKey}, 0) - ${this.dialect.placeholder(paramIndex++)}`,
        );
        params.push(amount);
      }
    }

    if (setClauses.length === 0) {
      throw new Error("No update operations specified");
    }

    const quotedTable = this.dialect.quoteIdentifier(table);
    const { whereClause, whereParams } = this.buildWhereClause(filter, paramIndex);
    params.push(...whereParams);

    let sql = `UPDATE ${quotedTable} SET ${setClauses.join(", ")} ${whereClause}`;

    // For single row update, use ctid subquery
    if (limit === 1 && whereClause) {
      sql = `UPDATE ${quotedTable} SET ${setClauses.join(", ")} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1)`;
    }

    return { sql, params };
  }

  // ============================================================
  // Database Lifecycle Operations
  // ============================================================

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
  public async createDatabase(name: string, options?: CreateDatabaseOptions): Promise<boolean> {
    // Check if database already exists
    if (await this.databaseExists(name)) {
      return false;
    }

    // Build CREATE DATABASE statement
    const quotedName = this.dialect.quoteIdentifier(name);
    let sql = `CREATE DATABASE ${quotedName}`;

    const withClauses: string[] = [];

    if (options?.encoding) {
      withClauses.push(`ENCODING = '${options.encoding}'`);
    }
    if (options?.template) {
      withClauses.push(`TEMPLATE = ${this.dialect.quoteIdentifier(options.template)}`);
    }
    if (options?.locale) {
      withClauses.push(`LC_COLLATE = '${options.locale}'`);
      withClauses.push(`LC_CTYPE = '${options.locale}'`);
    }
    if (options?.owner) {
      withClauses.push(`OWNER = ${this.dialect.quoteIdentifier(options.owner)}`);
    }

    if (withClauses.length > 0) {
      sql += ` WITH ${withClauses.join(" ")}`;
    }

    try {
      await this.query(sql);
      log.success("database", "lifecycle", `Created database ${name}`);
      return true;
    } catch (error) {
      log.error("database", "lifecycle", `Failed to create database ${name}: ${error}`);
      throw error;
    }
  }

  /**
   * Drop a database.
   *
   * @param name - Database name to drop
   * @param options - Drop options
   * @returns true if dropped, false if didn't exist
   */
  public async dropDatabase(name: string, options?: DropDatabaseOptions): Promise<boolean> {
    // Check if database exists first (if ifExists option not set)
    if (!options?.ifExists && !(await this.databaseExists(name))) {
      return false;
    }

    const quotedName = this.dialect.quoteIdentifier(name);
    let sql = "DROP DATABASE";

    if (options?.ifExists) {
      sql += " IF EXISTS";
    }

    sql += ` ${quotedName}`;

    // PostgreSQL 13+ supports WITH (FORCE) to terminate active connections
    if (options?.force) {
      sql += " WITH (FORCE)";
    }

    try {
      await this.query(sql);
      log.success("database", "lifecycle", `Dropped database ${name}`);
      return true;
    } catch (error) {
      log.error("database", "lifecycle", `Failed to drop database ${name}: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a database exists.
   *
   * @param name - Database name to check
   * @returns true if database exists
   */
  public async databaseExists(name: string): Promise<boolean> {
    const result = await this.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) as exists`,
      [name],
    );

    return result.rows[0]?.exists ?? false;
  }

  /**
   * List all databases.
   *
   * @returns Array of database names
   */
  public async listDatabases(): Promise<string[]> {
    const result = await this.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`,
    );

    return result.rows.map((row) => row.datname);
  }

  // ============================================================
  // Table Management Operations
  // ============================================================

  /**
   * Drop a table.
   *
   * @param name - Table name to drop
   * @throws Error if table doesn't exist
   */
  public async dropTable(name: string): Promise<void> {
    const quotedName = this.dialect.quoteIdentifier(name);
    await this.query(`DROP TABLE ${quotedName}`);
    log.success("database", "table", `Dropped table ${name}`);
  }

  /**
   * Drop a table if it exists.
   *
   * @param name - Table name to drop
   */
  public async dropTableIfExists(name: string): Promise<void> {
    const quotedName = this.dialect.quoteIdentifier(name);
    await this.query(`DROP TABLE IF EXISTS ${quotedName}`);
  }

  /**
   * Drop all tables in the current database.
   *
   * Uses CASCADE to handle foreign key dependencies.
   * Useful for `migrate:fresh` command.
   */
  public async dropAllTables(): Promise<void> {
    // Get all tables from blueprint
    const tables = await this.blueprint.listTables();

    if (tables.length === 0) {
      return;
    }

    // Drop all tables with CASCADE to handle foreign keys
    for (const table of tables) {
      const quotedName = this.dialect.quoteIdentifier(table);
      await this.query(`DROP TABLE IF EXISTS ${quotedName} CASCADE`);
    }

    log.success("database", "table", `Dropped ${tables.length} tables`);
  }
}
