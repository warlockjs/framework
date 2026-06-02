import { MigrationDefaults } from "../types.mjs";
import { TableIndexInformation } from "../contracts/driver-blueprint.contract.mjs";
import { ColumnDefinition, ForeignKeyDefinition, FullTextIndexOptions, GeoIndexOptions, IndexDefinition, MigrationDriverContract, VectorIndexOptions } from "../contracts/migration-driver.contract.mjs";
import { ColumnBuilder } from "./column-builder.mjs";
import { DetachedColumnBuilder } from "./column-helpers.mjs";
import { ChildModel } from "../model/model.types.mjs";
import { Model } from "../model/model.mjs";
import { DatabaseDriver } from "../utils/connect-to-database.mjs";
import { ForeignKeyBuilder } from "./foreign-key-builder.mjs";
import { DataSource } from "../data-source/data-source.mjs";

//#region ../../@warlock.js/cascade/src/migration/migration.d.ts
/**
 * Pending operation types supported by migrations.
 */
type OperationType = "addColumn" | "dropColumn" | "dropColumns" | "renameColumn" | "modifyColumn" | "createIndex" | "dropIndex" | "createUniqueIndex" | "dropUniqueIndex" | "createFullTextIndex" | "dropFullTextIndex" | "createGeoIndex" | "dropGeoIndex" | "createVectorIndex" | "dropVectorIndex" | "createTTLIndex" | "dropTTLIndex" | "addForeignKey" | "dropForeignKey" | "addPrimaryKey" | "dropPrimaryKey" | "addCheck" | "dropCheck" | "createTable" | "createTableIfNotExists" | "dropTable" | "dropTableIfExists" | "renameTable" | "truncateTable" | "createTimestamps" | "rawStatement" | "setSchemaValidation" | "removeSchemaValidation";
/**
 * Pending operation to be executed when migration runs.
 */
type PendingOperation = {
  readonly type: OperationType;
  readonly payload: unknown;
};
/**
 * Contract for a migration class.
 */
interface MigrationContract {
  /**
   * Table/collection name for this migration.
   */
  readonly table: string;
  /**
   * Optional data source override.
   */
  readonly dataSource?: string | DataSource;
  /**
   * Whether to wrap migration in a transaction.
   */
  readonly transactional?: boolean;
  /**
   * Define schema changes for the up migration.
   */
  up(): void | Promise<void>;
  /**
   * Define rollback operations for the down migration.
   */
  down(): void | Promise<void>;
  /**
   * Set the migration driver.
   *
   * @param driver - Migration driver instance
   * @internal
   */
  setDriver(driver: MigrationDriverContract): void;
  /**
   * Set migration defaults from the resolved DataSource.
   *
   * @param defaults - Migration defaults (UUID strategy, etc.)
   * @internal
   */
  setMigrationDefaults(defaults?: MigrationDefaults): void;
  /**
   * Get the migration driver.
   *
   * @returns The migration driver instance
   */
  getDriver(): MigrationDriverContract;
  /**
   * Execute all pending operations.
   *
   * @internal
   */
  execute(): Promise<void>;
  /**
   * Add a pending index definition.
   *
   * @param index - Index definition
   * @internal
   */
  addPendingIndex(index: IndexDefinition): void;
  /**
   * Add a foreign key operation.
   *
   * @param fk - Foreign key definition
   * @internal
   */
  addForeignKeyOperation(fk: ForeignKeyDefinition): void;
  /**
   * Create the table/collection.
   */
  createTable(): MigrationContract;
  /**
   * Create table if not exists
   */
  createTableIfNotExists(): MigrationContract;
  /**
   * Drop the table/collection.
   */
  dropTable(): MigrationContract;
  /**
   * Drop the table/collection if it exists.
   */
  dropTableIfExists(): MigrationContract;
  /**
   * Rename the table/collection.
   *
   * @param newName - New table name
   */
  renameTableTo(newName: string): MigrationContract;
  /**
   * Truncate the table — remove all rows without logging or firing triggers.
   */
  truncateTable(): MigrationContract;
  /**
   * Add a string/varchar column.
   */
  string(column: string, length?: number): ColumnBuilder;
  /**
   * Add a fixed-length char column.
   */
  char(column: string, length: number): ColumnBuilder;
  /**
   * Add a text column (unlimited length).
   */
  text(column: string): ColumnBuilder;
  /**
   * Add a medium text column.
   */
  mediumText(column: string): ColumnBuilder;
  /**
   * Add a long text column.
   */
  longText(column: string): ColumnBuilder;
  /**
   * Add an integer column.
   */
  integer(column: string): ColumnBuilder;
  /**
   * Alias for integer().
   */
  int(column: string): ColumnBuilder;
  /**
   * Add a small integer column.
   */
  smallInteger(column: string): ColumnBuilder;
  /**
   * Alias for smallInteger().
   */
  smallInt(column: string): ColumnBuilder;
  /**
   * Add a tiny integer column.
   */
  tinyInteger(column: string): ColumnBuilder;
  /**
   * Alias for tinyInteger().
   */
  tinyInt(column: string): ColumnBuilder;
  /**
   * Add a big integer column.
   */
  bigInteger(column: string): ColumnBuilder;
  /**
   * Alias for bigInteger().
   */
  bigInt(column: string): ColumnBuilder;
  /**
   * Add a float column.
   */
  float(column: string): ColumnBuilder;
  /**
   * Add a double precision column.
   */
  double(column: string): ColumnBuilder;
  /**
   * Add a decimal column with precision and scale.
   */
  decimal(column: string, precision?: number, scale?: number): ColumnBuilder;
  /**
   * Add a boolean column.
   */
  boolean(column: string): ColumnBuilder;
  /**
   * Alias for boolean().
   */
  bool(column: string): ColumnBuilder;
  /**
   * Add a date column (date only, no time).
   */
  date(column: string): ColumnBuilder;
  /**
   * Add a datetime column (date and time).
   */
  dateTime(column: string): ColumnBuilder;
  /**
   * Add a timestamp column.
   */
  timestamp(column: string): ColumnBuilder;
  /**
   * Add a time column (time only, no date).
   */
  time(column: string): ColumnBuilder;
  /**
   * Add a year column.
   */
  year(column: string): ColumnBuilder;
  /**
   * Add a JSON column.
   */
  json(column: string): ColumnBuilder;
  /**
   * Alias for json().
   */
  object(column: string): ColumnBuilder;
  /**
   * Add a binary/blob column.
   */
  binary(column: string): ColumnBuilder;
  /**
   * Alias for binary().
   */
  blob(column: string): ColumnBuilder;
  /**
   * Add a UUID column.
   */
  uuid(column: string): ColumnBuilder;
  /**
   * Add a ULID column.
   */
  ulid(column: string): ColumnBuilder;
  /**
   * Add an IP address column.
   */
  ipAddress(column: string): ColumnBuilder;
  /**
   * Add a MAC address column.
   */
  macAddress(column: string): ColumnBuilder;
  /**
   * Add a geo point column.
   */
  point(column: string): ColumnBuilder;
  /**
   * Add a polygon column.
   */
  polygon(column: string): ColumnBuilder;
  /**
   * Add a line string column.
   */
  lineString(column: string): ColumnBuilder;
  /**
   * Add a generic geometry column.
   */
  geometry(column: string): ColumnBuilder;
  /**
   * Add an enum column with allowed values.
   */
  enum(column: string, values: string[]): ColumnBuilder;
  /**
   * Add a set column (multiple values from a set).
   */
  set(column: string, values: string[]): ColumnBuilder;
  /** INTEGER[] — array of integers. */
  arrayInt(column: string): ColumnBuilder;
  /** BIGINT[] — array of big integers. */
  arrayBigInt(column: string): ColumnBuilder;
  /** REAL[] — array of floats. */
  arrayFloat(column: string): ColumnBuilder;
  /** DECIMAL[] — array of decimals (optional precision/scale). */
  arrayDecimal(column: string, precision?: number, scale?: number): ColumnBuilder;
  /** BOOLEAN[] — array of booleans. */
  arrayBoolean(column: string): ColumnBuilder;
  /** TEXT[] — array of text values. */
  arrayText(column: string): ColumnBuilder;
  /** DATE[] — array of dates. */
  arrayDate(column: string): ColumnBuilder;
  /** TIMESTAMPTZ[] — array of timestamps with time zone. */
  arrayTimestamp(column: string): ColumnBuilder;
  /** UUID[] — array of UUIDs. */
  arrayUuid(column: string): ColumnBuilder;
  /** JSONB[] — array of JSON objects. */
  arrayJson(column: string): ColumnBuilder;
  /**
   * Add an auto-increment primary key column.
   */
  id(name?: string): ColumnBuilder;
  /**
   * Add a big integer auto-increment primary key column.
   */
  bigId(name?: string): ColumnBuilder;
  /**
   * Add a UUID primary key column.
   */
  uuidId(name?: string): ColumnBuilder;
  /**
   * Add a UUID primary key column with automatic generation.
   *
   * PostgreSQL: Uses gen_random_uuid() (built-in since PG 13)
   * MongoDB: Application-level UUID generation
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.primaryUuid(); // id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   * this.primaryUuid("organization_id"); // Custom column name
   * ```
   */
  primaryUuid(name?: string): ColumnBuilder;
  /**
   * Add createdAt and updatedAt timestamp columns.
   */
  timestamps(): MigrationContract;
  /**
   * Add a deletedAt column for soft deletes.
   */
  softDeletes(column?: string): ColumnBuilder;
  /**
   * Drop a column.
   */
  dropColumn(column: string): MigrationContract;
  /**
   * Drop multiple columns.
   */
  dropColumns(...columns: string[]): MigrationContract;
  /**
   * Rename a column.
   */
  renameColumn(from: string, to: string): MigrationContract;
  /**
   * Create an index on one or more columns.
   *
   * @param columns - Column(s) to index
   * @param name - Optional index name
   * @param options - Optional index options (include, concurrently)
   */
  index(columns: string | string[], name?: string, options?: {
    include?: string[];
    concurrently?: boolean;
  }): MigrationContract;
  /**
   * Drop an index by name or columns.
   */
  dropIndex(nameOrColumns: string | string[]): MigrationContract;
  /**
   * Create a unique constraint/index.
   *
   * @param columns - Column(s) to make unique
   * @param name - Optional constraint name
   * @param options - Optional index options (include, concurrently)
   */
  unique(columns: string | string[], name?: string, options?: {
    include?: string[];
    concurrently?: boolean;
  }): MigrationContract;
  /**
   * Drop a unique constraint/index.
   */
  dropUnique(columns: string | string[]): MigrationContract;
  /**
   * Create an expression-based index.
   *
   * @param expressions - SQL expression(s) to index, e.g., ['lower(email)', 'upper(name)']
   * @param name - Optional index name
   * @param options - Optional index options (concurrently)
   */
  expressionIndex(expressions: string | string[], name?: string, options?: {
    concurrently?: boolean;
  }): MigrationContract;
  /**
   * Create a full-text search index.
   */
  fullText(columns: string | string[], options?: FullTextIndexOptions): MigrationContract;
  /**
   * Drop a full-text search index.
   */
  dropFullText(name: string): MigrationContract;
  /**
   * Create a geo-spatial index.
   */
  geoIndex(column: string, options?: GeoIndexOptions): MigrationContract;
  /**
   * Drop a geo-spatial index.
   */
  dropGeoIndex(column: string): MigrationContract;
  /**
   * Create a vector search index for AI embeddings.
   */
  vectorIndex(column: string, options: VectorIndexOptions): MigrationContract;
  /**
   * Drop a vector search index.
   */
  dropVectorIndex(column: string): MigrationContract;
  /**
   * Create a TTL (time-to-live) index for automatic document expiration.
   */
  ttlIndex(column: string, expireAfterSeconds: number): MigrationContract;
  /**
   * Drop a TTL index.
   */
  dropTTLIndex(column: string): MigrationContract;
  /**
   * Add a composite primary key.
   */
  primaryKey(columns: string[]): MigrationContract;
  /**
   * Drop the primary key constraint.
   */
  dropPrimaryKey(): MigrationContract;
  /**
   * Start building a foreign key constraint.
   */
  foreign(column: string): ForeignKeyBuilder;
  /**
   * Drop a foreign key constraint.
   *
   * When `referencesTable` is provided, the constraint name is auto-computed
   * using the same convention as `addForeignKey`:
   * `fk_{table}_{column}_{referencesTable}`
   *
   * When omitted, `columnOrConstraint` is used as the raw constraint name.
   */
  dropForeign(columnOrConstraint: string, referencesTable?: string): MigrationContract;
  /**
   * Set JSON schema validation rules on the collection.
   */
  schemaValidation(schema: object): MigrationContract;
  /**
   * Remove schema validation rules from the collection.
   */
  dropSchemaValidation(): MigrationContract;
  /**
   * Check if a table exists.
   */
  hasTable(tableName: string): Promise<boolean>;
  /**
   * Check if a column exists in the current table.
   */
  hasColumn(columnName: string): Promise<boolean>;
  /**
   * Get all columns in the current table.
   */
  getColumns(): Promise<ColumnDefinition[]>;
  /**
   * List all tables in the current database/connection.
   */
  listTables(): Promise<string[]>;
  /**
   * Get all indexes on the current table.
   */
  getIndexes(): Promise<TableIndexInformation[]>;
  /**
   * Check if a named index exists on the current table.
   */
  hasIndex(indexName: string): Promise<boolean>;
  /**
   * Queue a raw SQL string for execution within the migration.
   *
   * @param sql - SQL statement to execute
   */
  raw(sql: string): this;
  /**
   * Execute raw operations with direct driver/connection access.
   *
   * @param callback - Callback receiving the native connection
   */
  withConnection<T>(callback: (connection: unknown) => Promise<T>): Promise<T>;
  /**
   * Add a vector column for storing AI embeddings.
   *
   * @param column - Column name
   * @param dimensions - Embedding size (e.g. 1536 for text-embedding-3-small)
   */
  vector(column: string, dimensions: number): ColumnBuilder;
}
/**
 * Constructor for the migration class.
 */
interface MigrationConstructor {
  new (): MigrationContract;
  migrationName?: string;
  createdAt?: string;
  transactional?: boolean;
  order?: number;
}
/**
 * Base class for all database migrations.
 *
 * Provides a fluent API for defining schema changes that work across
 * both SQL and NoSQL databases. The migration driver handles translating
 * operations to native database commands.
 *
 * Migrations are executed in order based on their `createdAt` timestamp,
 * which is typically extracted from the filename (e.g., `2024-01-15_create-users`).
 *
 * @example
 * ```typescript
 * // Using Migration.for() to bind to a model
 * export default class extends Migration.for(User) {
 *   public up(): void {
 *     this.string("email").unique();
 *     this.integer("age").nullable();
 *     this.geoIndex("location");
 *   }
 *
 *   public down(): void {
 *     this.dropColumn("email");
 *     this.dropColumn("age");
 *     this.dropGeoIndex("location");
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Manual table migration (without model binding)
 * export default class CreateUsersTable extends Migration {
 *   public readonly table = "users";
 *
 *   public up(): void {
 *     this.createTable();
 *     this.id();
 *     this.string("name");
 *     this.string("email").unique();
 *     this.timestamps();
 *   }
 *
 *   public down(): void {
 *     this.dropTable();
 *   }
 * }
 * ```
 */
declare abstract class Migration implements MigrationContract {
  /**
   * Migration name that will be labeled with
   * If record is enabled in migration, it will be stored as migration name
   * in database
   *
   * @example
   * ```typescript
   * "2024-01-15_create-users";
   * ```
   */
  static migrationName?: string;
  /**
   * Table/collection name for this migration.
   *
   * Must be defined by each migration class (either directly or via `Migration.for()`).
   */
  readonly table: string;
  /**
   * Sort order
   * If not provided, it will be ordered alphabetically
   */
  static readonly order?: number;
  /**
   * Optional data source override.
   *
   * If specified, this migration will use a specific data source
   * instead of the default one. Can be a string name or DataSource instance.
   */
  readonly dataSource?: string | DataSource;
  /**
   * Optional timestamp override.
   *
   * By default, the migration runner extracts this from the filename.
   * Set explicitly to override the execution order.
   *
   * Format: ISO 8601 or any parseable date string.
   */
  static readonly createdAt?: string;
  /**
   * Whether to wrap migration in a transaction.
   *
   * Defaults to `true` for SQL databases that support DDL transactions.
   * Set to `false` for operations that cannot be transactional.
   *
   * Note: MongoDB does not support transactions for most DDL operations.
   */
  readonly transactional?: boolean;
  /**
   * Migration driver instance (injected by the runner).
   */
  protected driver: MigrationDriverContract;
  /**
   * Migration defaults from the resolved DataSource.
   * @internal
   */
  /** @internal — readable by factory-generated subclasses */
  protected _migrationDefaults?: MigrationDefaults;
  /**
   * Queued operations to execute.
   */
  private readonly pendingOperations;
  /**
   * Define schema changes for the up migration.
   *
   * Called when running migrations forward. Add columns, indexes,
   * constraints, etc. in this method.
   */
  abstract up(): void | Promise<void>;
  /**
   * Define rollback operations for the down migration.
   *
   * Called when rolling back migrations. Drop columns, indexes,
   * and undo any changes made in `up()`.
   */
  abstract down(): void | Promise<void>;
  /**
   * Create a migration class bound to a specific model.
   *
   * Automatically inherits the model's table name and data source,
   * reducing boilerplate and ensuring consistency.
   *
   * @param model - Model class to bind
   * @returns Abstract migration class bound to the model
   *
   * @example
   * ```typescript
   * export default class extends Migration.for(User) {
   *   public up(): void {
   *     this.string("avatar").nullable();
   *   }
   *
   *   public down(): void {
   *     this.dropColumn("avatar");
   *   }
   * }
   * ```
   */
  static for<T extends ChildModel<Model>>(model: T): MigrationConstructor;
  /**
   * Create a migration that executes raw SQL statements.
   *
   * Intended for external packages that ship engine-specific DDL — typically a
   * one-shot `CREATE TABLE` bundle whose `up` is the only direction that matters.
   * The `down` direction is optional; when omitted, rollback is a recorded no-op.
   *
   * Raw SQL is engine-locked by definition. This factory is rejected on MongoDB
   * data sources at execute time — use the fluent builder for cross-engine work.
   *
   * @param options - Migration name, SQL statements, and optional overrides
   * @returns Migration constructor ready to register with the runner
   *
   * @example
   * ```typescript
   * export const createAuthTables = Migration.rawSql({
   *   name: "create_auth_tables",
   *   up: [
   *     `CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL)`,
   *     `CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id))`,
   *   ],
   * });
   * ```
   */
  static rawSql(options: {
    /**
     * Migration name. Used as the tracking key in the migrations table — must
     * be unique across the application.
     */
    name: string;
    /**
     * SQL statement(s) to execute on the up direction.
     */
    up: string | string[];
    /**
     * Optional SQL statement(s) for rollback. If omitted, `down()` is a no-op
     * and rollback simply removes the tracking record.
     */
    down?: string | string[];
    /**
     * Optional data source override (string name or DataSource instance).
     */
    dataSource?: string | DataSource;
    /**
     * Whether to wrap execution in a transaction. Defaults to the runner's
     * resolved default.
     */
    transactional?: boolean;
  }): MigrationConstructor;
  /**
   * Set the migration driver.
   *
   * Called by the migration runner before executing up/down.
   *
   * @param driver - Migration driver instance
   * @internal
   */
  setDriver(driver: MigrationDriverContract): void;
  /**
   * Set migration defaults from the resolved DataSource.
   *
   * @param defaults - Migration defaults (UUID strategy, etc.)
   * @internal
   */
  setMigrationDefaults(defaults?: MigrationDefaults): void;
  /**
   * Get the migration driver.
   *
   * @returns The migration driver instance
   */
  getDriver(): MigrationDriverContract;
  /**
   * Get database engine (MongoDB, Postgress...etc)
   */
  get databaseEngine(): DatabaseDriver;
  /**
   * Execute all pending operations.
   *
   * @deprecated Use toSQL() instead — migrations now generate SQL rather than
   * executing DDL directly through the driver.
   * @internal
   */
  execute(): Promise<void>;
  /**
   * Serialize all queued pending operations into a flat list of SQL strings.
   *
   * Call this AFTER invoking `up()` or `down()` to extract the SQL for the
   * operations that were queued during that call. The pending queue is cleared
   * after serializing so the instance is safe to reuse.
   *
   * @example
   * ```typescript
   * const migration = new CreateUsersTable();
   * migration.setDriver(driver);
   *
   * // Up SQL
   * await migration.up();
   * const upSQL = migration.toSQL();
   *
   * // Down SQL — reuse the same instance
   * await migration.down();
   * const downSQL = migration.toSQL();
   * ```
   */
  toSQL(): string[];
  /**
   * Execute a single pending operation.
   */
  private executeOperation;
  /**
   * Check if a table exists.
   *
   * Useful for conditional migrations and idempotent operations.
   *
   * @param tableName - Table name to check
   * @returns Promise resolving to true if table exists
   *
   * @example
   * ```typescript
   * public async up() {
   *   if (await this.hasTable("users_backup")) {
   *     this.dropTable("users_backup");
   *   }
   *   // ... rest of migration
   * }
   * ```
   */
  hasTable(tableName: string): Promise<boolean>;
  /**
   * Check if a column exists in the current table.
   *
   * @param columnName - Column name to check
   * @returns Promise resolving to true if column exists
   *
   * @example
   * ```typescript
   * public async up() {
   *   if (!(await this.hasColumn("email"))) {
   *     this.string("email").unique();
   *   }
   * }
   * ```
   */
  hasColumn(columnName: string): Promise<boolean>;
  /**
   * Get all columns in the current table.
   *
   * @returns Promise resolving to array of column definitions
   *
   * @example
   * ```typescript
   * const columns = await this.getColumns();
   * if (columns.find(col => col.type === "string" && !col.length)) {
   *   // migrate all unbounded strings
   * }
   * ```
   */
  getColumns(): Promise<ColumnDefinition[]>;
  /**
   * List all tables in the current database/connection.
   *
   * @returns Promise resolving to array of table names
   *
   * @example
   * ```typescript
   * const tables = await this.listTables();
   * for (const table of tables) {
   *   // process each table
   * }
   * ```
   */
  listTables(): Promise<string[]>;
  /**
   * Get all indexes on the current table.
   */
  getIndexes(): Promise<TableIndexInformation[]>;
  /**
   * Check if a named index exists on the current table.
   */
  hasIndex(indexName: string): Promise<boolean>;
  /**
   * Add a pending index definition.
   *
   * Called by ColumnBuilder when .unique() or .index() is chained.
   * Routes into pendingOperations so indexes execute in definition order
   * alongside columns and constraints.
   *
   * @param index - Index definition
   * @internal
   */
  addPendingIndex(index: IndexDefinition): void;
  /**
   * Add a foreign key operation.
   *
   * Called by ForeignKeyBuilder or ColumnBuilder when .references() is called.
   *
   * @param fk - Foreign key definition
   * @internal
   */
  addForeignKeyOperation(fk: ForeignKeyDefinition): void;
  /**
   * Create the table/collection.
   *
   * For SQL, this creates an empty table.
   * For MongoDB, this creates the collection.
   *
   * @returns This migration for chaining
   */
  createTable(): this;
  /**
   * Create table if not exists
   */
  createTableIfNotExists(): this;
  /**
   * Drop the table/collection.
   *
   * @returns This migration for chaining
   */
  dropTable(): this;
  /**
   * Drop the table/collection if it exists.
   *
   * No error is thrown if the table doesn't exist.
   *
   * @returns This migration for chaining
   */
  dropTableIfExists(): this;
  /**
   * Rename the table/collection.
   *
   * @param newName - New table name
   * @returns This migration for chaining
   */
  renameTableTo(newName: string): this;
  /**
   * Truncate the table — remove all rows without logging or firing triggers.
   *
   * Faster than DELETE with no WHERE clause. Resets auto-increment counters
   * on most databases.
   *
   * @returns This migration for chaining
   */
  truncateTable(): this;
  /**
   * Add a string/varchar column.
   *
   * @param column - Column name
   * @param length - Max length (default: 255)
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.string("name"); // VARCHAR(255)
   * this.string("code", 10); // VARCHAR(10)
   * ```
   */
  string(column: string, length?: number): ColumnBuilder;
  /**
   * Add a fixed-length char column.
   *
   * @param column - Column name
   * @param length - Exact length
   * @returns Column builder for chaining modifiers
   */
  char(column: string, length: number): ColumnBuilder;
  /**
   * Add a text column (unlimited length).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  text(column: string): ColumnBuilder;
  /**
   * Add a medium text column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  mediumText(column: string): ColumnBuilder;
  /**
   * Add a long text column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  longText(column: string): ColumnBuilder;
  /**
   * Add an integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  integer(column: string): ColumnBuilder;
  /**
   * Alias for integer().
   */
  int(column: string): ColumnBuilder;
  /**
   * Add a small integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  smallInteger(column: string): ColumnBuilder;
  /**
   * Alias for smallInteger().
   */
  smallInt(column: string): ColumnBuilder;
  /**
   * Add a tiny integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  tinyInteger(column: string): ColumnBuilder;
  /**
   * Alias for tinyInteger().
   */
  tinyInt(column: string): ColumnBuilder;
  /**
   * Add a big integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  bigInteger(column: string): ColumnBuilder;
  /**
   * Alias for bigInteger().
   */
  bigInt(column: string): ColumnBuilder;
  /**
   * Add a float column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  float(column: string): ColumnBuilder;
  /**
   * Add a double precision column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  double(column: string): ColumnBuilder;
  /**
   * Add a decimal column with precision and scale.
   *
   * @param column - Column name
   * @param precision - Total digits (default: 8)
   * @param scale - Decimal places (default: 2)
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.decimal("price", 10, 2); // DECIMAL(10,2) - up to 99999999.99
   * ```
   */
  decimal(column: string, precision?: number, scale?: number): ColumnBuilder;
  /**
   * Add a boolean column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  boolean(column: string): ColumnBuilder;
  /**
   * Alias for boolean().
   */
  bool(column: string): ColumnBuilder;
  /**
   * Add a date column (date only, no time).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  date(column: string): ColumnBuilder;
  /**
   * Add a datetime column (date and time).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  dateTime(column: string): ColumnBuilder;
  /**
   * Add a timestamp column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  timestamp(column: string): ColumnBuilder;
  /**
   * Add a time column (time only, no date).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  time(column: string): ColumnBuilder;
  /**
   * Add a year column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  year(column: string): ColumnBuilder;
  /**
   * Add a JSON column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  json(column: string): ColumnBuilder;
  /**
   * Alias for json().
   */
  object(column: string): ColumnBuilder;
  /**
   * Add a binary/blob column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  binary(column: string): ColumnBuilder;
  /**
   * Alias for binary().
   */
  blob(column: string): ColumnBuilder;
  /**
   * Add a UUID column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  uuid(column: string): ColumnBuilder;
  /**
   * Add a ULID column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  ulid(column: string): ColumnBuilder;
  /**
   * Add an IP address column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  ipAddress(column: string): ColumnBuilder;
  /**
   * Add a MAC address column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  macAddress(column: string): ColumnBuilder;
  /**
   * Add a geo point column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  point(column: string): ColumnBuilder;
  /**
   * Add a polygon column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  polygon(column: string): ColumnBuilder;
  /**
   * Add a line string column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  lineString(column: string): ColumnBuilder;
  /**
   * Add a generic geometry column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  geometry(column: string): ColumnBuilder;
  /**
   * Add a vector column for AI embeddings.
   *
   * Used for storing and searching ML embeddings (e.g., OpenAI, Cohere).
   *
   * @param column - Column name
   * @param dimensions - Vector dimensions (e.g., 1536 for OpenAI ada-002)
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.vector("embedding", 1536); // OpenAI ada-002
   * this.vector("embedding", 384);  // Sentence Transformers
   * ```
   */
  vector(column: string, dimensions: number): ColumnBuilder;
  /**
   * Add an enum column with allowed values.
   *
   * @param column - Column name
   * @param values - Allowed enum values
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.enum("status", ["pending", "active", "archived"]);
   * ```
   */
  enum(column: string, values: string[]): ColumnBuilder;
  /**
   * Add a set column (multiple values from a set).
   *
   * @param column - Column name
   * @param values - Allowed set values
   * @returns Column builder for chaining modifiers
   */
  set(column: string, values: string[]): ColumnBuilder;
  /**
   * Add an INTEGER[] column (array of integers).
   *
   * @example
   * ```typescript
   * this.arrayInt("scores"); // INTEGER[]
   * ```
   */
  arrayInt(column: string): ColumnBuilder;
  /**
   * Add a BIGINT[] column (array of big integers).
   *
   * @example
   * ```typescript
   * this.arrayBigInt("ids"); // BIGINT[]
   * ```
   */
  arrayBigInt(column: string): ColumnBuilder;
  /**
   * Add a REAL[] column (array of floats).
   *
   * @example
   * ```typescript
   * this.arrayFloat("weights"); // REAL[]
   * ```
   */
  arrayFloat(column: string): ColumnBuilder;
  /**
   * Add a DECIMAL[] column (array of decimals).
   *
   * @param precision - Total digits
   * @param scale - Digits after decimal point
   *
   * @example
   * ```typescript
   * this.arrayDecimal("prices", 10, 2); // DECIMAL(10,2)[]
   * this.arrayDecimal("amounts");        // DECIMAL[]
   * ```
   */
  arrayDecimal(column: string, precision?: number, scale?: number): ColumnBuilder;
  /**
   * Add a BOOLEAN[] column (array of booleans).
   *
   * @example
   * ```typescript
   * this.arrayBoolean("flags"); // BOOLEAN[]
   * ```
   */
  arrayBoolean(column: string): ColumnBuilder;
  /**
   * Add a TEXT[] column (array of text values).
   *
   * @example
   * ```typescript
   * this.arrayText("tags"); // TEXT[]
   * ```
   */
  arrayText(column: string): ColumnBuilder;
  /**
   * Add a DATE[] column (array of dates).
   *
   * @example
   * ```typescript
   * this.arrayDate("holidays"); // DATE[]
   * ```
   */
  arrayDate(column: string): ColumnBuilder;
  /**
   * Add a TIMESTAMPTZ[] column (array of timestamps with time zone).
   *
   * @example
   * ```typescript
   * this.arrayTimestamp("events"); // TIMESTAMPTZ[]
   * ```
   */
  arrayTimestamp(column: string): ColumnBuilder;
  /**
   * Add a UUID[] column (array of UUIDs).
   *
   * @example
   * ```typescript
   * this.arrayUuid("relatedIds"); // UUID[]
   * ```
   */
  arrayUuid(column: string): ColumnBuilder;
  /**
   * Add a JSONB[] column — array of JSON objects.
   *
   * @example
   * ```typescript
   * this.arrayJson("metadata"); // JSONB[]
   * ```
   */
  arrayJson(column: string): ColumnBuilder;
  /**
   * Add an auto-increment primary key column.
   *
   * Creates an unsigned integer with primary key and auto-increment.
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.id(); // Creates "id" column
   * this.id("userId"); // Creates "userId" column
   * ```
   */
  id(name?: string): ColumnBuilder;
  /**
   * Add a big integer auto-increment primary key column.
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   */
  bigId(name?: string): ColumnBuilder;
  /**
   * Add a UUID primary key column.
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   */
  uuidId(name?: string): ColumnBuilder;
  /**
   * Add a UUID primary key column with automatic generation.
   *
   * Delegates UUID expression to the migration driver, which resolves
   * the default based on `migrationDefaults` from the DataSource config.
   *
   * Resolution order:
   * 1. `migrationDefaults.uuidExpression` (raw escape hatch)
   * 2. `migrationDefaults.uuidStrategy` (mapped per driver)
   * 3. Driver default (PostgreSQL: `gen_random_uuid()`, MongoDB: undefined)
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   *
   * @example
   * ```typescript
   * this.primaryUuid(); // id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   * this.primaryUuid("organization_id"); // Custom column name
   * ```
   */
  primaryUuid(name?: string): ColumnBuilder;
  /**
   * Add createdAt and updatedAt timestamp columns.
   *
   * Behavior varies by database driver:
   * - PostgreSQL: Creates TIMESTAMPTZ columns with NOW() defaults
   * - MongoDB: No-op (timestamps handled at application level)
   *
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.timestamps(); // Driver-specific implementation
   * ```
   */
  timestamps(): this;
  /**
   * Add a deletedAt column for soft deletes.
   *
   * @param column - Column name (default: "deletedAt")
   * @returns Column builder for chaining modifiers
   */
  softDeletes(column?: string): ColumnBuilder;
  /**
   * Drop a column.
   *
   * @param column - Column name to drop
   * @returns This migration for chaining
   */
  dropColumn(column: string): this;
  /**
   * Drop multiple columns.
   *
   * @param columns - Column names to drop
   * @returns This migration for chaining
   */
  dropColumns(...columns: string[]): this;
  /**
   * Rename a column.
   *
   * @param from - Current column name
   * @param to - New column name
   * @returns This migration for chaining
   */
  renameColumn(from: string, to: string): this;
  /**
   * Create an index on one or more columns.
   *
   * @param columns - Column(s) to index
   * @param name - Optional index name
   * @param options - Optional index options (include, concurrently)
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.index("email");
   * this.index(["firstName", "lastName"], "name_idx");
   * this.index("userId", "idx_user", { include: ["name", "email"] });
   * this.index("email", "idx_email", { concurrently: true });
   * ```
   */
  index(columns: string | string[], name?: string, options?: {
    include?: string[];
    concurrently?: boolean;
  }): this;
  /**
   * Drop an index by name or columns.
   *
   * @param nameOrColumns - Index name (string) or columns array
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.dropIndex("email_idx"); // Drop by name
   * this.dropIndex(["firstName", "lastName"]); // Drop by columns
   * ```
   */
  dropIndex(nameOrColumns: string | string[]): this;
  /**
   * Create a unique constraint/index.
   *
   * @param columns - Column(s) to make unique
   * @param name - Optional constraint name
   * @param options - Optional index options (include, concurrently)
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.unique("email");
   * this.unique(["userId", "roleId"], "unique_user_role");
   * this.unique("email", "unique_email", { include: ["name"] });
   * ```
   */
  unique(columns: string | string[], name?: string, options?: {
    include?: string[];
    concurrently?: boolean;
  }): this;
  /**
   * Drop a unique constraint/index.
   *
   * @param columns - Columns in the unique constraint
   * @returns This migration for chaining
   */
  dropUnique(columns: string | string[]): this;
  /**
   * Create an expression-based index.
   *
   * Allows indexing on SQL expressions rather than plain columns.
   * Useful for case-insensitive searches, computed values, etc.
   *
   * **Note**: PostgreSQL-specific feature. MongoDB will silently ignore this.
   *
   * @param expressions - SQL expression(s) to index
   * @param name - Optional index name
   * @param options - Optional index options (concurrently)
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * // Case-insensitive email index
   * this.expressionIndex(['lower(email)'], 'idx_email_lower');
   *
   * // Multiple expressions
   * this.expressionIndex(['lower(firstName)', 'lower(lastName)'], 'idx_name_lower');
   *
   * // With concurrent creation (requires transactional = false)
   * this.expressionIndex(['lower(email)'], 'idx_email_lower', { concurrently: true });
   * ```
   */
  expressionIndex(expressions: string | string[], name?: string, options?: {
    concurrently?: boolean;
  }): this;
  /**
   * Create a full-text search index.
   *
   * @param columns - Column(s) to index
   * @param options - Full-text options
   * @returns This migration for chaining
   */
  fullText(columns: string | string[], options?: FullTextIndexOptions): this;
  /**
   * Drop a full-text search index.
   *
   * @param name - Index name
   * @returns This migration for chaining
   */
  dropFullText(name: string): this;
  /**
   * Create a geo-spatial index.
   *
   * @param column - Geo column
   * @param options - Geo index options
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.geoIndex("location"); // 2dsphere index
   * this.geoIndex("coordinates", { type: "2d" }); // 2d index
   * ```
   */
  geoIndex(column: string, options?: GeoIndexOptions): this;
  /**
   * Drop a geo-spatial index.
   *
   * @param column - Geo column
   * @returns This migration for chaining
   */
  dropGeoIndex(column: string): this;
  /**
   * Create a vector search index for AI embeddings.
   *
   * @param column - Vector column
   * @param options - Vector index options
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.vectorIndex("embedding", {
   *   dimensions: 1536,
   *   similarity: "cosine",
   * });
   * ```
   */
  vectorIndex(column: string, options: VectorIndexOptions): this;
  /**
   * Drop a vector search index.
   *
   * @param column - Vector column
   * @returns This migration for chaining
   */
  dropVectorIndex(column: string): this;
  /**
   * Create a TTL (time-to-live) index for automatic document expiration.
   *
   * Primarily for MongoDB. Documents are automatically deleted after the
   * specified time has passed since the date in the column.
   *
   * @param column - Date column to check for expiration
   * @param expireAfterSeconds - Seconds after which documents expire
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * // Delete sessions 24 hours after createdAt
   * this.ttlIndex("createdAt", 86400);
   * ```
   */
  ttlIndex(column: string, expireAfterSeconds: number): this;
  /**
   * Drop a TTL index.
   *
   * @param column - Column with TTL
   * @returns This migration for chaining
   */
  dropTTLIndex(column: string): this;
  /**
   * Add a composite primary key.
   *
   * @param columns - Columns to include in the primary key
   * @returns This migration for chaining
   */
  primaryKey(columns: string[]): this;
  /**
   * Drop the primary key constraint.
   *
   * @returns This migration for chaining
   */
  dropPrimaryKey(): this;
  /**
   * Add a CHECK constraint to the table.
   *
   * SQL-only feature. PostgreSQL, MySQL 8.0+, SQLite support this.
   * Validates that rows satisfy the given SQL expression.
   *
   * @param name - Constraint name
   * @param expression - SQL CHECK expression
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.check("age_positive", "age >= 0");
   * this.check("valid_email", "email LIKE '%@%'");
   * this.check("price_range", "price BETWEEN 0 AND 1000000");
   * ```
   */
  check(name: string, expression: string): this;
  /**
   * Drop a CHECK constraint by name.
   *
   * @param name - Constraint name
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.dropCheck("age_positive");
   * ```
   */
  dropCheck(name: string): this;
  /**
   * Start building a foreign key constraint on an existing column.
   *
   * Use this when adding a foreign key to a column that was defined in a
   * previous migration. For new columns, prefer the inline form:
   * `this.integer("user_id").references("users").onDelete("cascade")`
   *
   * SQL-only feature; NoSQL drivers ignore foreign keys.
   *
   * @param column - Local column that references another table
   * @returns Foreign key builder for chaining
   *
   * @example
   * ```typescript
   * this.foreign("user_id")
   *   .references("users", "id")
   *   .onDelete("cascade");
   * ```
   */
  foreign(column: string): ForeignKeyBuilder;
  /**
   * Drop a foreign key constraint.
   *
   * Two calling forms:
   *
   * 1. Auto-compute the name (matches what `addForeignKey` generates):
   *    ```typescript
   *    this.dropForeign("unit_id", Unit.table);
   *    // → drops: fk_{table}_unit_id_units
   *    ```
   *
   * 2. Raw constraint name (use when the name was set explicitly):
   *    ```typescript
   *    this.dropForeign("my_custom_fk_name");
   *    ```
   *
   * @param columnOrConstraint - Column name (auto mode) or raw constraint name (raw mode)
   * @param referencesTable - Referenced table name; triggers auto-name computation when provided
   * @returns This migration for chaining
   */
  dropForeign(columnOrConstraint: string, referencesTable?: string): this;
  /**
   * Set JSON schema validation rules on the collection.
   *
   * MongoDB-only feature. SQL databases ignore this.
   *
   * @param schema - JSON Schema object
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.schemaValidation({
   *   bsonType: "object",
   *   required: ["name", "email"],
   *   properties: {
   *     name: { bsonType: "string" },
   *     email: { bsonType: "string" },
   *   },
   * });
   * ```
   */
  schemaValidation(schema: object): this;
  /**
   * Remove schema validation rules from the collection.
   *
   * @returns This migration for chaining
   */
  dropSchemaValidation(): this;
  /**
   * Execute raw operations with direct driver/connection access.
   *
   * Use this when you need to bypass the migration API entirely and
   * interact with the native database driver directly.
   *
   * @param callback - Callback receiving the native connection
   * @returns Result from callback
   *
   * @example
   * ```typescript
   * await this.withConnection(async (db) => {
   *   await db.collection("users").updateMany({}, { $set: { active: true } });
   * });
   * ```
   */
  withConnection<T>(callback: (connection: unknown) => Promise<T>): Promise<T>;
  /**
   * Queue a raw SQL string for execution within the migration.
   *
   * The statement is queued and executed in order with other migration
   * operations, within the transaction context if the migration is transactional.
   *
   * Use `withConnection()` instead if you need direct driver access.
   *
   * Works with PostgreSQL, MySQL, etc. For MongoDB, uses $eval command.
   *
   * @param sql - SQL statement to execute
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * // Enable PostgreSQL extension
   * this.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
   *
   * // Create custom type
   * this.raw('CREATE TYPE mood AS ENUM (\'happy\', \'sad\', \'neutral\')');
   * ```
   */
  raw(sql: string): this;
  /**
   * Create a declarative initial-table migration.
   * Implemented and assigned below the class body.
   */
  static create: (model: ChildModel<Model<any>>, columns: ColumnMap, options?: MigrationCreateOptions) => MigrationConstructor;
  /**
   * Create a declarative alteration migration.
   * Implemented and assigned below the class body.
   */
  static alter: (model: ChildModel<Model<any>>, schema: AlterSchema, options?: MigrationAlterOptions) => MigrationConstructor;
}
declare function migrate(model: ChildModel<Model<any>>, options?: {
  createdAt?: string;
  name?: string;
  up?: (this: MigrationContract) => void | Promise<void>;
  down?: (this: MigrationContract) => void | Promise<void>;
  transactional?: boolean;
}): MigrationConstructor;
/**
 * A single composite index entry for `Migration.create()` options.
 *
 * @example
 * ```typescript
 * // Simple — columns only, name and type auto-resolved
 * { columns: ["organization_id", "content_type"] }
 *
 * // Named
 * { columns: ["organization_id", "content_type"], name: "idx_org_content" }
 *
 * // Typed (PostgreSQL)
 * { columns: ["embedding"], using: "ivfflat" }
 * ```
 */
type IndexEntry = {
  /** Column(s) to include in the index. */columns: string | string[]; /** Optional explicit index name. Auto-generated when omitted. */
  name?: string;
  /**
   * Index access method (PostgreSQL).
   * Defaults to `"btree"` when omitted.
   */
  using?: "btree" | "hash" | "gin" | "gist" | "brin" | "ivfflat" | "hnsw" | (string & {}); /** Extra columns to include in a covering index (PostgreSQL `INCLUDE`). */
  include?: string[]; /** Build the index without locking the table (PostgreSQL). */
  concurrently?: boolean;
};
/**
 * A single composite unique constraint entry for `Migration.create()` options.
 *
 * @example
 * ```typescript
 * // Simple
 * { columns: ["organization_id", "email"] }
 *
 * // Named — useful when you need to reference it in a future ALTER
 * { columns: ["org_id", "content_id", "lang"], name: "uq_summary_idempotency" }
 * ```
 */
type UniqueEntry = {
  /** Column(s) that must be unique together. */columns: string | string[]; /** Optional explicit constraint name. Auto-generated when omitted. */
  name?: string; /** Extra columns to include (PostgreSQL covering unique index). */
  include?: string[]; /** Build the constraint without locking the table (PostgreSQL). */
  concurrently?: boolean;
};
/**
 * Options accepted by `Migration.create()`.
 */
type MigrationCreateOptions = {
  /**
   * Sort order override.
   * @default 0
   */
  order?: number;
  /**
   * ISO timestamp override for migration ordering.
   * Normally extracted from the filename by the runner.
   */
  createdAt?: string;
  /**
   * Override the primary key type for this migration only.
   *
   * - `"uuid"` — UUID primary key (uses `primaryUuid()`)
   * - `"int"` — Auto-increment integer (uses `id()`)
   * - `"bigInt"` — Big auto-increment integer (uses `bigId()`)
   * - `false` — Skip primary key generation entirely
   *
   * When omitted, falls back to `migrationDefaults.primaryKey` from the
   * DataSource config, then to `"int"` as the framework default.
   */
  primaryKey?: "uuid" | "int" | "bigInt" | false;
  /**
   * Whether to add `timestamps()` (created_at / updated_at).
   * @default true
   */
  timestamps?: boolean;
  /**
   * Whether to wrap this migration in a transaction.
   * Falls back to DataSource / driver defaults when omitted.
   */
  transactional?: boolean;
  /**
   * Composite indexes to create on the table.
   *
   * Use this for multi-column indexes. Single-column indexes should be
   * defined at the column level via `.index()`.
   *
   * @example
   * ```typescript
   * index: [
   *   { columns: ["organization_id", "content_type", "content_id"] },
   *   { columns: ["organization_id", "status"], name: "idx_org_status" },
   * ]
   * ```
   */
  index?: IndexEntry[];
  /**
   * Composite unique constraints to create on the table.
   *
   * Use this for multi-column uniqueness. Single-column unique constraints
   * should be defined at the column level via `.unique()`.
   *
   * @example
   * ```typescript
   * unique: [
   *   {
   *     columns: ["organization_id", "content_id", "content_language"],
   *     name: "uq_summary_idempotency",
   *   },
   * ]
   * ```
   */
  unique?: UniqueEntry[];
  /**
   * Custom logic to execute after the declarative definitions.
   * Useful for data seeding or raw SQL following table creation.
   */
  up?: (this: Migration) => void | Promise<void>;
  /**
   * Raw SQL queries to run before the custom `up` logic.
   * Useful for triggering statements or custom constraints.
   */
  raw?: string | string[];
  /**
   * Custom rollback logic to execute before the default `dropTableIfExists`.
   */
  down?: (this: Migration) => void | Promise<void>;
};
/**
 * Column map accepted by `Migration.create()` and `Migration.alter()`.
 *
 * Keys become the column names; values are `DetachedColumnBuilder` instances
 * produced by the standalone column helpers (`uuid()`, `text()`, etc.).
 */
type ColumnMap = Record<string, DetachedColumnBuilder>;
/**
 * Options accepted by `Migration.alter()`.
 */
type MigrationAlterOptions = {
  /** Sort order override. */order?: number; /** ISO timestamp override. */
  createdAt?: string; /** Whether to wrap in a transaction. */
  transactional?: boolean;
  /**
   * Custom logic to execute after the declarative definitions.
   */
  up?: (this: Migration) => void | Promise<void>;
  /**
   * Custom rollback logic to execute on rollback.
   * Unlike `create()`, `alter()` does not auto-infer rollbacks.
   */
  down?: (this: Migration) => void | Promise<void>;
};
/**
 * Schema map passed to `Migration.alter()`.
 *
 * Groups all table-level DDL operations by intent.
 * Any key can be omitted when not needed.
 *
 * @example
 * ```typescript
 * export default Migration.alter(User, {
 *   // Column operations
 *   add:    { phone: text().nullable() },
 *   drop:   ["legacy_column"],
 *   rename: { old_name: "new_name" },
 *   modify: { email: string(320).notNullable() },
 *
 *   // Index / constraint operations
 *   addIndex:   [{ columns: ["first_name", "last_name"] }],
 *   addUnique:  [{ columns: ["email"] }],
 *   addForeign: [{ column: "team_id", references: Team }],
 *   dropIndexes: ["old_idx_name"],
 *   dropUnique:  [["email"]],
 * });
 * ```
 */
type AlterSchema = {
  /** Columns to add. Keys become column names. */add?: ColumnMap; /** Column names to drop. */
  drop?: string[]; /** Rename map: `{ oldName: newName }`. */
  rename?: Record<string, string>; /** Columns to modify. Keys become column names. */
  modify?: ColumnMap;
  /**
   * Regular indexes to add.
   *
   * @example
   * ```typescript
   * addIndex: [
   *   { columns: "email" },
   *   { columns: ["first_name", "last_name"], name: "idx_full_name" },
   *   { columns: "email", options: { concurrently: true } },
   * ]
   * ```
   */
  addIndex?: Array<{
    columns: string | string[];
    name?: string;
    options?: {
      include?: string[];
      concurrently?: boolean;
    };
  }>;
  /**
   * Indexes to drop (by name or columns array).
   *
   * @example
   * ```typescript
   * dropIndex: ["idx_old_name", ["first_name", "last_name"]]
   * ```
   */
  dropIndex?: Array<string | string[]>;
  /**
   * Unique constraints / indexes to add.
   *
   * @example
   * ```typescript
   * addUnique: [{ columns: "email" }]
   * ```
   */
  addUnique?: Array<{
    columns: string | string[];
    name?: string;
    options?: {
      include?: string[];
      concurrently?: boolean;
    };
  }>;
  /**
   * Unique constraints to drop (by columns array).
   *
   * @example
   * ```typescript
   * dropUnique: [["email"], ["phone"]]
   * ```
   */
  dropUnique?: Array<string | string[]>;
  /**
   * Expression-based indexes to add (PostgreSQL-specific).
   *
   * @example
   * ```typescript
   * addExpressionIndex: [
   *   { expressions: "lower(email)", name: "idx_email_lower" },
   * ]
   * ```
   */
  addExpressionIndex?: Array<{
    expressions: string | string[];
    name?: string;
    options?: {
      concurrently?: boolean;
    };
  }>;
  /**
   * Full-text search indexes to add.
   *
   * @example
   * ```typescript
   * addFullText: [{ columns: ["title", "body"] }]
   * ```
   */
  addFullText?: Array<{
    columns: string | string[];
    options?: FullTextIndexOptions;
  }>; /** Full-text indexes to drop (by name). */
  dropFullText?: string[];
  /**
   * Geo-spatial indexes to add.
   *
   * @example
   * ```typescript
   * addGeoIndex: [{ column: "location" }]
   * ```
   */
  addGeoIndex?: Array<{
    column: string;
    options?: GeoIndexOptions;
  }>; /** Geo indexes to drop (by column name). */
  dropGeoIndex?: string[];
  /**
   * Vector search indexes to add.
   *
   * @example
   * ```typescript
   * addVectorIndex: [{ column: "embedding", options: { dimensions: 1536, similarity: "cosine" } }]
   * ```
   */
  addVectorIndex?: Array<{
    column: string;
    options: VectorIndexOptions;
  }>; /** Vector indexes to drop (by column name). */
  dropVectorIndex?: string[];
  /**
   * TTL indexes to add (MongoDB-primary).
   *
   * @example
   * ```typescript
   * addTTLIndex: [{ column: "created_at", expireAfterSeconds: 86400 }]
   * ```
   */
  addTTLIndex?: Array<{
    column: string;
    expireAfterSeconds: number;
  }>; /** TTL indexes to drop (by column name). */
  dropTTLIndex?: string[];
  /**
   * Foreign keys to add to existing columns.
   *
   * Accepts a Model class or a raw table-name string for `references`.
   *
   * @example
   * ```typescript
   * addForeign: [
   *   { column: "team_id",  references: Team,       onDelete: "cascade" },
   *   { column: "owner_id", references: "users",    on: "id", onDelete: "setNull" },
   * ]
   * ```
   */
  addForeign?: Array<{
    column: string;
    references: string | {
      table: string;
    };
    on?: string;
    onDelete?: "cascade" | "restrict" | "setNull" | "noAction";
    onUpdate?: "cascade" | "restrict" | "setNull" | "noAction";
  }>;
  /**
   * Foreign keys to drop.
   *
   * Two forms:
   * - `{ columnOrConstraint: "team_id", referencesTable: "teams" }` → auto-name resolution
   * - `{ columnOrConstraint: "fk_my_custom_name" }` → raw constraint name
   */
  dropForeign?: Array<{
    columnOrConstraint: string;
    referencesTable?: string;
  }>;
  /**
   * CHECK constraints to add.
   *
   * @example
   * ```typescript
   * addCheck: [{ name: "age_positive", expression: "age >= 0" }]
   * ```
   */
  addCheck?: Array<{
    name: string;
    expression: string;
  }>; /** CHECK constraints to drop (by name). */
  dropCheck?: string[];
  /**
   * Raw SQL queries to execute as part of this alter operation.
   */
  raw?: string | string[];
};
//#endregion
export { AlterSchema, ColumnMap, IndexEntry, Migration, MigrationAlterOptions, MigrationConstructor, MigrationContract, MigrationCreateOptions, OperationType, PendingOperation, UniqueEntry, migrate };
//# sourceMappingURL=migration.d.mts.map