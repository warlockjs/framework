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
  TransactionContext,
  UpdateOperations,
  UpdateResult,
} from "../../contracts/database-driver.contract";
import type { DriverBlueprintContract } from "../../contracts/driver-blueprint.contract";
import type { MigrationDriverContract } from "../../contracts/migration-driver.contract";
import type { QueryBuilderContract } from "../../contracts/query-builder.contract";
import type { SyncAdapterContract } from "../../contracts/sync-adapter.contract";
import { TransactionRollbackError } from "../../errors/transaction-rollback.error";
import { SQLSerializer } from "../../migration/sql-serializer";
import { SqlDatabaseDirtyTracker } from "../../sql-database-dirty-tracker";
import type { ModelDefaults } from "../../types";
import { DatabaseDriver } from "../../utils/connect-to-database";
import { isValidDateValue } from "../../utils/is-valid-date-value";
import { PostgresBlueprint } from "./postgres-blueprint";
import { PostgresDialect } from "./postgres-dialect";
import { PostgresMigrationDriver } from "./postgres-migration-driver";
import { PostgresQueryBuilder } from "./postgres-query-builder";
import { PostgresSQLSerializer } from "./postgres-sql-serializer";
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
  public readonly name = "postgres" as DatabaseDriver;

  /**
   * SQL dialect for PostgreSQL-specific syntax.
   */
  public readonly dialect = new PostgresDialect();

  /**
   * PostgreSQL driver model defaults.
   *
   * PostgreSQL follows SQL conventions:
   * - snake_case naming for columns (created_at, updated_at, deleted_at)
   * - Native AUTO_INCREMENT for IDs (no manual generation)
   * - Timestamps enabled by default
   * - Permanent delete strategy (hard deletes)
   */
  public readonly modelDefaults: Partial<ModelDefaults> = {
    namingConvention: "snake_case",
    createdAtColumn: "created_at",
    updatedAtColumn: "updated_at",
    deletedAtColumn: "deleted_at",
    timestamps: true,
    autoGenerateId: false, // PostgreSQL uses SERIAL/BIGSERIAL
    strictMode: "fail",
    deleteStrategy: "permanent",
  };

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
   * Explicit, table-agnostic override list of column names that hold native
   * PostgreSQL arrays (`JSONB[]`, `TEXT[]`, …) and must NOT be JSON-text
   * encoded. Merged with (and superseded per-table by) the schema
   * introspection below; kept as a manual escape hatch.
   *
   * @see PostgresPoolConfig.nativeArrayColumns
   */
  private readonly _nativeArrayColumns: ReadonlySet<string>;

  /**
   * Native-array columns discovered by introspecting the live schema on
   * connect, keyed `table → { column, … }`. Authoritative and table-scoped, so
   * a column that is `TEXT[]` in one table and `jsonb` in another is encoded
   * correctly for each — no app configuration required.
   */
  private _introspectedArrayColumns: ReadonlyMap<string, ReadonlySet<string>> = new Map();

  /**
   * Create a new PostgreSQL driver instance.
   *
   * @param config - PostgreSQL connection configuration
   */
  public constructor(private readonly config: PostgresPoolConfig) {
    this._nativeArrayColumns = new Set(config.nativeArrayColumns ?? []);
  }

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
   * Get database native client
   */
  public getClient<Client = PgPool>(): Client {
    return this.pool as Client;
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
        "database.postgres",
        "connection",
        `Connecting to database ${colors.bold(colors.yellowBright(this.config.database))}`,
      );

      this._pool = new pg.Pool(poolConfig);

      // Test the connection
      const client = await this._pool.connect();
      client.release();

      log.success(
        "database.postgres",
        "connection",
        `Connected to database ${colors.bold(colors.yellowBright(this.config.database))}`,
      );

      this._isConnected = true;

      // Learn which columns are native arrays straight from the live schema so
      // the value serializer encodes them correctly with zero app config.
      await this.loadNativeArrayColumns();

      this.emit("connected");
    } catch (error) {
      // Boot-time database connection failure is unrecoverable in every
      // realistic caller (app boot, CLI migrations, workers) — `fatal` makes
      // "page on fatal only" alerting clean. Per-query failures stay at error.
      log.fatal("database.postgres", "connection", "Failed to connect to database");
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
   * @param table - Optional table name; when given, columns introspected as
   *   native arrays on that table are bound raw (see {@link serializeValue}).
   * @returns Serialized data ready for PostgreSQL
   */
  public serialize(
    data: Record<string, unknown>,
    table?: string,
  ): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        continue; // Skip undefined values
      }

      serialized[key] = this.serializeValue(key, value, table);
    }

    return serialized;
  }

  /**
   * Serialize a single column value into a node-pg bindable parameter.
   *
   * Shared by {@link serialize} (INSERT path) and {@link buildUpdateQuery}
   * `$set` (UPDATE path) so both encode `json` / `jsonb` columns identically.
   *
   * Encoding rules (in order):
   * - `Date` → ISO string.
   * - `bigint` → decimal string (node-pg has no native bigint binding).
   * - all-number array → pgvector literal `'[n1,n2,...]'`. node-pg would
   *   otherwise emit a `{n1,n2,...}` array literal, which the `vector` type
   *   rejects. This branch is preserved exactly.
   * - any other array (object-array, string-array, mixed, empty `[]`) →
   *   `JSON.stringify`. node-pg renders a raw JS array as a PostgreSQL array
   *   literal `{...}` (and `[]` as `{}`), which a `json` / `jsonb` column
   *   rejects — so we bind the value as JSON text instead, the form those
   *   columns accept. Columns known to be native arrays — via schema
   *   introspection or the `nativeArrayColumns` config — are exempt: their raw
   *   array is passed through so node-pg emits the `{...}` literal a genuine
   *   `JSONB[]` / `TEXT[]` column needs.
   * - plain object → `JSON.stringify`. Equivalent to node-pg's own object
   *   handling, made explicit so both write paths agree.
   * - everything else (scalars: string, number, boolean, null) → untouched.
   *
   * Distinguishing native-array from `json` / `jsonb` columns: a value alone
   * can't tell them apart, so the driver introspects the live schema on connect
   * (see {@link loadNativeArrayColumns}) and consults that per-table map here
   * via {@link isNativeArrayColumn}. The explicit `nativeArrayColumns` config
   * still works as a table-agnostic override. No `::jsonb` placeholder cast is
   * added: a JSON-text string binds correctly to `json` / `jsonb` without one,
   * and a blind cast would misfire on columns we cannot positively identify as
   * jsonb.
   *
   * @param key - Column name (used to resolve native-array columns)
   * @param value - The raw value to serialize (never `undefined`)
   * @param table - Optional table name; enables the per-table native-array lookup
   * @returns The value ready to bind as a query parameter
   */
  private serializeValue(key: string, value: unknown, table?: string): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Array.isArray(value)) {
      if (value.length > 0 && value.every((v) => typeof v === "number")) {
        // pgvector columns expect the literal '[n1,n2,...]' format.
        return `[${value.join(",")}]`;
      }

      // Genuine native PostgreSQL array columns (JSONB[], TEXT[], …) must
      // keep their raw array so node-pg emits a '{...}' array literal.
      if (this.isNativeArrayColumn(table, key)) {
        return value;
      }

      // json / jsonb columns: bind as JSON text. Covers object-arrays,
      // string-arrays, mixed arrays, and empty [] (which would otherwise
      // store as '{}' instead of '[]').
      return JSON.stringify(value);
    }

    if (typeof value === "object" && value !== null) {
      // Plain object → JSONB. Explicit JSON.stringify matches node-pg's own
      // object encoding while keeping both write paths consistent.
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Whether `column` on `table` is a native PostgreSQL array. True when the
   * connect-time schema introspection saw it as `data_type = 'ARRAY'` for that
   * table (authoritative, per-table), or when it's listed in the table-agnostic
   * `nativeArrayColumns` config override.
   */
  private isNativeArrayColumn(table: string | undefined, column: string): boolean {
    if (table && this._introspectedArrayColumns.get(table)?.has(column)) {
      return true;
    }

    return this._nativeArrayColumns.has(column);
  }

  /**
   * Introspect the live schema for native-array columns so array values bind
   * correctly with zero app configuration.
   *
   * A JS array must be bound two opposite ways depending on the column: as JSON
   * text for a `json` / `jsonb` column, but as a raw array (which node-pg
   * renders `{...}`) for a native `TEXT[]` / `JSONB[]` / `INTEGER[]` column. The
   * serializer sees values, not types, so without this it JSON-stringifies
   * every array — which a native-array column rejects with "malformed array
   * literal". One `information_schema` query at connect, cached for the
   * connection lifetime, removes the need to hand-list `nativeArrayColumns`.
   *
   * Best-effort: any failure (e.g. restricted catalog access) is logged and
   * leaves the map empty so the config override still applies — it never blocks
   * connect. A schema change made within a live connection isn't reflected
   * until the next connect.
   */
  private async loadNativeArrayColumns(): Promise<void> {
    try {
      const result = await this.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = ANY (current_schemas(false))
           AND data_type = 'ARRAY'`,
      );

      const map = new Map<string, Set<string>>();

      for (const { table_name, column_name } of result.rows) {
        let columns = map.get(table_name);

        if (!columns) {
          columns = new Set<string>();
          map.set(table_name, columns);
        }

        columns.add(column_name);
      }

      this._introspectedArrayColumns = map;
    } catch {
      // Introspection is an optimization, never a hard dependency — fall back
      // to the `nativeArrayColumns` config so a locked-down catalog or an
      // unusual search_path can't break connect.
      log.warn(
        "database.postgres",
        "introspection",
        "Could not introspect native-array columns; using the nativeArrayColumns config only",
      );
    }
  }

  /**
   * Get the dirty tracker for this driver.
   */
  public getDirtyTracker(data: Record<string, unknown>): SqlDatabaseDirtyTracker {
    return new SqlDatabaseDirtyTracker(data);
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
    for (const [key, value] of Object.entries(data)) {
      // Only re-inflate strings — pg already returns Date objects from DB reads
      if (typeof value !== "string") continue;

      if (isValidDateValue(value)) {
        data[key] = new Date(value);
        continue;
      }

      // pgvector columns are returned as '[n1,n2,...]' strings.
      // charCodeAt is faster than startsWith/endsWith — no string allocation.
      // '[' = 91, ']' = 93
      if (value.charCodeAt(0) === 91 && value.charCodeAt(value.length - 1) === 93) {
        const parts = value.slice(1, -1).split(",");
        const nums = new Array<number>(parts.length);
        let isNumericVector = parts.length > 0;

        for (let i = 0; i < parts.length; i++) {
          const n = +parts[i]; // unary + is the fastest string-to-number coercion
          if (!Number.isFinite(n)) {
            isNumericVector = false;
            break; // early-exit — not a numeric vector, leave value untouched
          }
          nums[i] = n;
        }

        if (isNumericVector) {
          data[key] = nums;
        }
      }
    }

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
    const serialized = this.serialize(document, table);

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
      document: result.rows[0],
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
      const serialized = this.serialize(doc, table);
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
      const serialized = this.serialize(doc, table);
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

    return result.rows as unknown as InsertResult[];
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
    try {
      const result = await this.query(sql, params);

      return {
        modifiedCount: result.rowCount ?? 0,
      };
    } catch (error) {
      console.log("PG Query Error in:", sql, params);

      throw error;
    }
  }

  /**
   * Find one and update a single row matching the filter and return the updated row
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param update - Update operations ($set, $unset, $inc)
   * @param options - Optional update options
   * @returns The updated row or null
   */
  public async findOneAndUpdate<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    _options?: Record<string, unknown>,
  ): Promise<T | null> {
    const { sql, params } = this.buildUpdateQuery(table, filter, update, 1);
    // Add RETURNING * to get the updated row back
    const sqlWithReturning = `${sql} RETURNING *`;
    const result = await this.query<T>(sqlWithReturning, params);
    return result.rows[0] ?? null;
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
    const serialized = this.serialize(document, table);
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
  public async upsert<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T> {
    const serialized = this.serialize(document, table);
    const columns = Object.keys(serialized);
    const values = Object.values(serialized);

    if (columns.length === 0) {
      throw new Error("Cannot upsert empty document");
    }

    const quotedTable = this.dialect.quoteIdentifier(table);
    const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
    const placeholders = columns.map((_, i) => this.dialect.placeholder(i + 1)).join(", ");

    // Determine conflict columns from options or filter
    const conflictColumns = (options?.conflictColumns as string[]) ?? Object.keys(filter);
    if (conflictColumns.length === 0) {
      throw new Error("Upsert requires conflictColumns option or filter with columns");
    }

    const quotedConflictColumns = conflictColumns
      .map((c) => this.dialect.quoteIdentifier(c))
      .join(", ");

    // Build UPDATE clause for ON CONFLICT
    // Update all columns except the conflict columns (they stay the same)
    const updateColumns = columns.filter((col) => !conflictColumns.includes(col));
    const setClauses = updateColumns
      .map((col, i) => {
        const valueIndex = columns.indexOf(col) + 1;
        return `${this.dialect.quoteIdentifier(col)} = ${this.dialect.placeholder(valueIndex)}`;
      })
      .join(", ");

    // If there are no columns to update (all columns are conflict columns), use EXCLUDED
    const updateClause =
      setClauses.length > 0
        ? setClauses
        : columns
            .map(
              (col) =>
                `${this.dialect.quoteIdentifier(col)} = EXCLUDED.${this.dialect.quoteIdentifier(col)}`,
            )
            .join(", ");

    const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT (${quotedConflictColumns}) DO UPDATE SET ${updateClause} RETURNING *`;

    const result = await this.query<T>(sql, values);

    return result.rows[0]! as T;
  }

  /**
   * Find one and delete a single row matching the filter and return the deleted row.
   *
   * @param table - Target table name
   * @param filter - Filter conditions
   * @param options - Optional delete options
   * @returns The deleted row or null
   */
  public async findOneAndDelete<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<T | null> {
    const quotedTable = this.dialect.quoteIdentifier(table);
    const { whereClause, whereParams } = this.buildWhereClause(filter, 1);

    // Use ctid for single row deletion with RETURNING
    const sql = `DELETE FROM ${quotedTable} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1) RETURNING *`;

    const result = await this.query<T>(sql, whereParams);

    return result.rows[0] ? (result.rows[0] as T) : null;
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
   * @param options.cascade - If true, automatically truncate all tables with foreign key references (use with caution)
   * @returns Number of deleted rows (always 0 for TRUNCATE)
   */
  public async truncateTable(table: string, options?: { cascade?: boolean }): Promise<number> {
    const quotedTable = this.dialect.quoteIdentifier(table);
    const cascadeClause = options?.cascade ? " CASCADE" : "";
    await this.query(`TRUNCATE TABLE ${quotedTable} RESTART IDENTITY${cascadeClause}`);
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
  public async transaction<T>(
    fn: (ctx: TransactionContext) => Promise<T>,
    options?: Record<string, unknown>,
  ): Promise<T> {
    const ctx: TransactionContext = {
      rollback(reason?: string): never {
        throw new TransactionRollbackError(reason);
      },
    };

    // Flat nesting: a transaction() called while one is already active JOINS it
    // instead of opening a second, independent transaction on another pool
    // connection. An independent inner transaction can't see the outer's
    // uncommitted writes (a row inserted moments earlier), so a service that
    // opens its own transaction — correct when called standalone — would hit
    // phantom FK violations when called inside an outer transaction (e.g. a
    // seeder that creates a row, then calls a service that references it). The
    // outermost transaction owns BEGIN / COMMIT / ROLLBACK; the inner block
    // runs on the same session, and a throw still unwinds the whole outer
    // transaction. (Savepoint-based partial rollback is a separate, explicit
    // concern — use `beginTransaction()` directly for that.)
    if (databaseTransactionContext.hasActiveTransaction()) {
      return fn(ctx);
    }

    const tx = await this.beginTransaction(options);

    // Set transaction context for queries within callback
    databaseTransactionContext.enter({ session: tx.context });

    try {
      // Execute callback
      const result = await fn(ctx);

      // Auto-commit on success
      await tx.commit();

      return result;
    } catch (error) {
      // Auto-rollback on any error (including explicit rollback)
      await tx.rollback();
      log.error(
        `database.postgress`,
        "transaction",
        "Transaction operation failed, rolled back everything",
      );
      throw error;
    } finally {
      // Guaranteed cleanup
      databaseTransactionContext.exit();
    }
  }

  /**
   * Perform an atomic update operation.
   *
   * Builds and executes an UPDATE query for the given filter and operations.
   * Updates EVERY matching row — the MongoDB driver's atomic() delegates to
   * updateMany, and Model.findAndUpdate documents multi-row semantics, so the
   * two drivers must agree.
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
    const { sql, params } = this.buildUpdateQuery(table, filter, operations);

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
   * Return a SQL serializer for this driver's dialect.
   * Used by Migration.toSQL() to convert pending operations to SQL strings.
   */
  public getSQLSerializer(): SQLSerializer {
    return new PostgresSQLSerializer(this.dialect);
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

    const startTime = this.config.logging ? performance.now() : 0;

    let paramsString = "";
    if (this.config.logging && params.length > 0) {
      paramsString = JSON.stringify(params);
      if (paramsString.length > 300) {
        paramsString = paramsString.substring(0, 300) + "...";
      }
      paramsString = ` | Params: ${paramsString}`;
    }

    try {
      let result;
      if (this.config.logging) {
        log.info({
          module: "database.postgres",
          action: "query.executing",
          message: `${sql}${paramsString}`,
          context: { params, sql },
        });
      }
      if (txClient) {
        result = await txClient.query(sql, params);
      } else {
        result = await this.pool.query(sql, params);
      }

      if (this.config.logging) {
        const duration = (performance.now() - startTime).toFixed(2);
        log.success({
          module: "database.postgres",
          action: "query.executed",
          message: `[${duration}ms] ${sql}${paramsString}`,
          context: { params, sql, duration },
        });
      }

      return result as PostgresQueryResult<T>;
    } catch (error) {
      if (this.config.logging) {
        const duration = (performance.now() - startTime).toFixed(2);
        log.error({
          module: "database.postgres",
          action: "query.error",
          message: `[${duration}ms] ${sql}${paramsString}`,
          context: {
            sql,
            params,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    }
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
   * Values are bound as plain equality, except Mongo-style operator objects
   * (`{ $in: [...] }`, `{ $gt: 5 }`, ...) which are translated to their SQL
   * equivalents — driver-level callers (e.g. pivot detach) build filters in
   * that portable form. An unrecognized `$` operator throws instead of being
   * bound literally, which would only surface as a cryptic type error from
   * Postgres.
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
      } else if (this.isOperatorFilter(value)) {
        for (const [operator, operand] of Object.entries(value as Record<string, unknown>)) {
          switch (operator) {
            case "$in":
            case "$nin": {
              const list = operand as unknown[];
              if (list.length === 0) {
                // $in [] matches nothing; $nin [] matches everything.
                conditions.push(operator === "$in" ? "FALSE" : "TRUE");
                break;
              }
              const placeholders = list.map(() => this.dialect.placeholder(paramIndex++));
              params.push(...list);
              conditions.push(
                `${quotedKey} ${operator === "$in" ? "IN" : "NOT IN"} (${placeholders.join(", ")})`,
              );
              break;
            }
            case "$eq":
              if (operand === null) {
                conditions.push(`${quotedKey} IS NULL`);
              } else {
                conditions.push(`${quotedKey} = ${this.dialect.placeholder(paramIndex++)}`);
                params.push(operand);
              }
              break;
            case "$ne":
              if (operand === null) {
                conditions.push(`${quotedKey} IS NOT NULL`);
              } else {
                conditions.push(`${quotedKey} != ${this.dialect.placeholder(paramIndex++)}`);
                params.push(operand);
              }
              break;
            case "$gt":
            case "$gte":
            case "$lt":
            case "$lte": {
              const sqlOperator = { $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" }[operator];
              conditions.push(`${quotedKey} ${sqlOperator} ${this.dialect.placeholder(paramIndex++)}`);
              params.push(operand);
              break;
            }
            default:
              throw new Error(
                `Unsupported filter operator "${operator}" for column "${key}" on the Postgres driver.`,
              );
          }
        }
      } else {
        conditions.push(`${quotedKey} = ${this.dialect.placeholder(paramIndex++)}`);
        params.push(value);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return { whereClause, whereParams: params };
  }

  /**
   * A filter value is an operator object when it is a plain object whose keys
   * ALL start with `$`. Arrays, Dates, and value objects (e.g. jsonb equality
   * payloads) keep their existing bind-as-value behavior.
   */
  private isOperatorFilter(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    if (value instanceof Date || Buffer.isBuffer(value)) {
      return false;
    }

    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.startsWith("$"));
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
        // Apply the same json/jsonb-aware serialization used on the INSERT
        // path so object/array $set values aren't corrupted into Postgres
        // array literals. undefined is skipped — never bind it.
        params.push(value === undefined ? value : this.serializeValue(key, value, table));
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
