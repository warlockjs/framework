import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  FullTextIndexOptions,
  GeoIndexOptions,
  IndexDefinition,
  MigrationDriverContract,
  TableIndexInformation,
  VectorIndexOptions,
} from "../contracts/migration-driver.contract";
import type { DataSource } from "../data-source/data-source";
import type { ChildModel, Model } from "../model/model";
import { ColumnBuilder } from "./column-builder";
import { ForeignKeyBuilder } from "./foreign-key-builder";

/**
 * Pending operation types supported by migrations.
 */
type OperationType =
  | "addColumn"
  | "dropColumn"
  | "dropColumns"
  | "renameColumn"
  | "modifyColumn"
  | "createIndex"
  | "dropIndex"
  | "createUniqueIndex"
  | "dropUniqueIndex"
  | "createFullTextIndex"
  | "dropFullTextIndex"
  | "createGeoIndex"
  | "dropGeoIndex"
  | "createVectorIndex"
  | "dropVectorIndex"
  | "createTTLIndex"
  | "dropTTLIndex"
  | "addForeignKey"
  | "dropForeignKey"
  | "addPrimaryKey"
  | "dropPrimaryKey"
  | "addCheck"
  | "dropCheck"
  | "createTable"
  | "createTableIfNotExists"
  | "dropTable"
  | "dropTableIfExists"
  | "renameTable"
  | "truncateTable"
  | "setSchemaValidation"
  | "removeSchemaValidation";

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
export interface MigrationContract {
  /**
   * Table/collection name for this migration.
   */
  readonly table: string;

  /**
   * Optional data source override.
   */
  readonly dataSource?: string | DataSource;

  /**
   * Optional timestamp override.
   */
  readonly createdAt?: string;

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
   * Add a vector column for AI embeddings.
   */
  vector(column: string, dimensions: number): ColumnBuilder;

  /**
   * Add an enum column with allowed values.
   */
  enum(column: string, values: string[]): ColumnBuilder;

  /**
   * Add a set column (multiple values from a set).
   */
  set(column: string, values: string[]): ColumnBuilder;

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
  index(
    columns: string | string[],
    name?: string,
    options?: { include?: string[]; concurrently?: boolean },
  ): MigrationContract;

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
  unique(
    columns: string | string[],
    name?: string,
    options?: { include?: string[]; concurrently?: boolean },
  ): MigrationContract;

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
  expressionIndex(
    expressions: string | string[],
    name?: string,
    options?: { concurrently?: boolean },
  ): MigrationContract;

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
   * Drop a foreign key constraint by name.
   */
  dropForeign(name: string): MigrationContract;

  /**
   * Set JSON schema validation rules on the collection.
   */
  schemaValidation(schema: object): MigrationContract;

  /**
   * Remove schema validation rules from the collection.
   */
  dropSchemaValidation(): MigrationContract;

  /**
   * Execute raw operations with direct driver access.
   */
  raw<T>(callback: (connection: unknown) => Promise<T>): Promise<T>;

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
}

/**
 * Constructor for the migration class.
 */
export interface MigrationConstructor {
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
export abstract class Migration implements MigrationContract {
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
  public static migrationName?: string;

  /**
   * Table/collection name for this migration.
   *
   * Must be defined by each migration class (either directly or via `Migration.for()`).
   */
  public readonly table!: string;

  /**
   * Sort order
   * If not provided, it will be ordered alphabetically
   */
  public static readonly order?: number;

  /**
   * Optional data source override.
   *
   * If specified, this migration will use a specific data source
   * instead of the default one. Can be a string name or DataSource instance.
   */
  public readonly dataSource?: string | DataSource;

  /**
   * Optional timestamp override.
   *
   * By default, the migration runner extracts this from the filename.
   * Set explicitly to override the execution order.
   *
   * Format: ISO 8601 or any parseable date string.
   */
  public readonly createdAt?: string;

  /**
   * Whether to wrap migration in a transaction.
   *
   * Defaults to `true` for SQL databases that support DDL transactions.
   * Set to `false` for operations that cannot be transactional.
   *
   * Note: MongoDB does not support transactions for most DDL operations.
   */
  public readonly transactional?: boolean;

  /**
   * Migration driver instance (injected by the runner).
   */
  protected driver!: MigrationDriverContract;

  /**
   * Queued operations to execute.
   */
  private readonly pendingOperations: PendingOperation[] = [];

  // ============================================================================
  // ABSTRACT METHODS
  // ============================================================================

  /**
   * Define schema changes for the up migration.
   *
   * Called when running migrations forward. Add columns, indexes,
   * constraints, etc. in this method.
   */
  public abstract up(): void | Promise<void>;

  /**
   * Define rollback operations for the down migration.
   *
   * Called when rolling back migrations. Drop columns, indexes,
   * and undo any changes made in `up()`.
   */
  public abstract down(): void | Promise<void>;

  // ============================================================================
  // STATIC FACTORY
  // ============================================================================

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
  public static for<T extends ChildModel<Model>>(model: T): MigrationConstructor {
    abstract class BoundMigration extends Migration {
      public readonly table = model.table;
      public readonly dataSource = model.dataSource;
    }

    return BoundMigration as unknown as MigrationConstructor;
  }

  // ============================================================================
  // DRIVER INJECTION
  // ============================================================================

  /**
   * Set the migration driver.
   *
   * Called by the migration runner before executing up/down.
   *
   * @param driver - Migration driver instance
   * @internal
   */
  public setDriver(driver: MigrationDriverContract): void {
    this.driver = driver;
  }

  /**
   * Get the migration driver.
   *
   * @returns The migration driver instance
   */
  public getDriver(): MigrationDriverContract {
    return this.driver;
  }

  // ============================================================================
  // EXECUTE OPERATIONS
  // ============================================================================

  /**
   * Execute all pending operations.
   *
   * Called by the migration runner after up() or down() completes.
   * Executes operations in the order they were defined.
   *
   * @internal
   */
  public async execute(): Promise<void> {
    for (const op of this.pendingOperations) {
      await this.executeOperation(op);
    }

    this.pendingOperations.length = 0;
  }

  /**
   * Execute a single pending operation.
   */
  private async executeOperation(op: PendingOperation): Promise<void> {
    switch (op.type) {
      case "addColumn": {
        const column = op.payload as ColumnDefinition;
        await this.driver.addColumn(this.table, column);

        if (column.checkConstraint) {
          await this.driver.addCheck(
            this.table,
            column.checkConstraint.name,
            column.checkConstraint.expression,
          );
        }
        break;
      }

      case "dropColumn":
        await this.driver.dropColumn(this.table, op.payload as string);
        break;

      case "dropColumns":
        await this.driver.dropColumns(this.table, op.payload as string[]);
        break;

      case "renameColumn": {
        const { from, to } = op.payload as { from: string; to: string };
        await this.driver.renameColumn(this.table, from, to);
        break;
      }

      case "modifyColumn":
        await this.driver.modifyColumn(this.table, op.payload as ColumnDefinition);
        break;

      case "createIndex":
        await this.driver.createIndex(this.table, op.payload as IndexDefinition);
        break;

      case "dropIndex":
        await this.driver.dropIndex(this.table, op.payload as string);
        break;

      case "createUniqueIndex": {
        const { columns, name } = op.payload as {
          columns: string[];
          name?: string;
        };
        await this.driver.createUniqueIndex(this.table, columns, name);
        break;
      }

      case "dropUniqueIndex":
        await this.driver.dropUniqueIndex(this.table, op.payload as string[]);
        break;

      case "createFullTextIndex": {
        const { columns, options } = op.payload as {
          columns: string[];
          options?: FullTextIndexOptions;
        };
        await this.driver.createFullTextIndex(this.table, columns, options);
        break;
      }

      case "dropFullTextIndex":
        await this.driver.dropFullTextIndex(this.table, op.payload as string);
        break;

      case "createGeoIndex": {
        const { column, options } = op.payload as {
          column: string;
          options?: GeoIndexOptions;
        };
        await this.driver.createGeoIndex(this.table, column, options);
        break;
      }

      case "dropGeoIndex":
        await this.driver.dropGeoIndex(this.table, op.payload as string);
        break;

      case "createVectorIndex": {
        const { column, options } = op.payload as {
          column: string;
          options: VectorIndexOptions;
        };
        await this.driver.createVectorIndex(this.table, column, options);
        break;
      }

      case "dropVectorIndex":
        await this.driver.dropVectorIndex(this.table, op.payload as string);
        break;

      case "createTTLIndex": {
        const { column, seconds } = op.payload as {
          column: string;
          seconds: number;
        };
        await this.driver.createTTLIndex(this.table, column, seconds);
        break;
      }

      case "dropTTLIndex":
        await this.driver.dropTTLIndex(this.table, op.payload as string);
        break;

      case "addForeignKey":
        await this.driver.addForeignKey(this.table, op.payload as ForeignKeyDefinition);
        break;

      case "dropForeignKey":
        await this.driver.dropForeignKey(this.table, op.payload as string);
        break;

      case "addPrimaryKey":
        await this.driver.addPrimaryKey(this.table, op.payload as string[]);
        break;

      case "dropPrimaryKey":
        await this.driver.dropPrimaryKey(this.table);
        break;

      case "addCheck": {
        const { name, expression } = op.payload as { name: string; expression: string };
        await this.driver.addCheck(this.table, name, expression);
        break;
      }

      case "dropCheck":
        await this.driver.dropCheck(this.table, op.payload as string);
        break;

      case "createTable":
        await this.driver.createTable(this.table);
        break;

      case "createTableIfNotExists":
        await this.driver.createTableIfNotExists(this.table);
        break;

      case "dropTable":
        await this.driver.dropTable(this.table);
        break;

      case "dropTableIfExists":
        await this.driver.dropTableIfExists(this.table);
        break;

      case "renameTable":
        await this.driver.renameTable(this.table, op.payload as string);
        break;

      case "truncateTable":
        await this.driver.truncateTable(this.table);
        break;

      case "setSchemaValidation":
        await this.driver.setSchemaValidation(this.table, op.payload as object);
        break;

      case "removeSchemaValidation":
        await this.driver.removeSchemaValidation(this.table);
        break;
    }
  }

  // ============================================================================
  // SCHEMA INSPECTION
  // ============================================================================

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
  public async hasTable(tableName: string): Promise<boolean> {
    return this.driver.tableExists(tableName);
  }

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
  public async hasColumn(columnName: string): Promise<boolean> {
    const columns = await this.getColumns();
    return columns.some((col) => col.name === columnName);
  }

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
  public async getColumns(): Promise<ColumnDefinition[]> {
    return this.driver.listColumns(this.table);
  }

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
  public async listTables(): Promise<string[]> {
    return this.driver.listTables();
  }

  /**
   * Get all indexes on the current table.
   */
  public async getIndexes(): Promise<TableIndexInformation[]> {
    return this.driver.listIndexes(this.table);
  }

  /**
   * Check if a named index exists on the current table.
   */
  public async hasIndex(indexName: string): Promise<boolean> {
    const indexes = await this.getIndexes();
    return indexes.some((idx) => idx.name === indexName);
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

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
  public addPendingIndex(index: IndexDefinition): void {
    if (index.unique) {
      this.pendingOperations.push({
        type: "createUniqueIndex",
        payload: { columns: index.columns, name: index.name },
      });
    } else {
      this.pendingOperations.push({
        type: "createIndex",
        payload: index,
      });
    }
  }

  /**
   * Add a foreign key operation.
   *
   * Called by ForeignKeyBuilder or ColumnBuilder when .references() is called.
   *
   * @param fk - Foreign key definition
   * @internal
   */
  public addForeignKeyOperation(fk: ForeignKeyDefinition): void {
    this.pendingOperations.push({
      type: "addForeignKey",
      payload: fk,
    });
  }

  // ============================================================================
  // TABLE OPERATIONS
  // ============================================================================

  /**
   * Create the table/collection.
   *
   * For SQL, this creates an empty table.
   * For MongoDB, this creates the collection.
   *
   * @returns This migration for chaining
   */
  public createTable(): this {
    this.pendingOperations.push({ type: "createTable", payload: null });
    return this;
  }

  /**
   * Create table if not exists
   */
  public createTableIfNotExists(): this {
    this.pendingOperations.push({ type: "createTableIfNotExists", payload: null });
    return this;
  }

  /**
   * Drop the table/collection.
   *
   * @returns This migration for chaining
   */
  public dropTable(): this {
    this.pendingOperations.push({ type: "dropTable", payload: null });
    return this;
  }

  /**
   * Drop the table/collection if it exists.
   *
   * No error is thrown if the table doesn't exist.
   *
   * @returns This migration for chaining
   */
  public dropTableIfExists(): this {
    this.pendingOperations.push({ type: "dropTableIfExists", payload: null });
    return this;
  }

  /**
   * Rename the table/collection.
   *
   * @param newName - New table name
   * @returns This migration for chaining
   */
  public renameTableTo(newName: string): this {
    this.pendingOperations.push({ type: "renameTable", payload: newName });
    return this;
  }

  /**
   * Truncate the table — remove all rows without logging or firing triggers.
   *
   * Faster than DELETE with no WHERE clause. Resets auto-increment counters
   * on most databases.
   *
   * @returns This migration for chaining
   */
  public truncateTable(): this {
    this.pendingOperations.push({ type: "truncateTable", payload: null });
    return this;
  }

  // ============================================================================
  // COLUMN TYPES - STRING
  // ============================================================================

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
  public string(column: string, length = 255): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "string", { length });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a fixed-length char column.
   *
   * @param column - Column name
   * @param length - Exact length
   * @returns Column builder for chaining modifiers
   */
  public char(column: string, length: number): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "char", { length });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a text column (unlimited length).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public text(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "text");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a medium text column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public mediumText(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "mediumText");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a long text column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public longText(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "longText");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - NUMERIC
  // ============================================================================

  /**
   * Add an integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public integer(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "integer");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for integer().
   */
  public int(column: string): ColumnBuilder {
    return this.integer(column);
  }

  /**
   * Add a small integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public smallInteger(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "smallInteger");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for smallInteger().
   */
  public smallInt(column: string): ColumnBuilder {
    return this.smallInteger(column);
  }

  /**
   * Add a tiny integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public tinyInteger(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "tinyInteger");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for tinyInteger().
   */
  public tinyInt(column: string): ColumnBuilder {
    return this.tinyInteger(column);
  }

  /**
   * Add a big integer column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public bigInteger(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "bigInteger");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for bigInteger().
   */
  public bigInt(column: string): ColumnBuilder {
    return this.bigInteger(column);
  }

  /**
   * Add a float column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public float(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "float");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a double precision column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public double(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "double");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

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
  public decimal(column: string, precision = 8, scale = 2): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "decimal", {
      precision,
      scale,
    });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - BOOLEAN
  // ============================================================================

  /**
   * Add a boolean column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public boolean(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "boolean");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for boolean().
   */
  public bool(column: string): ColumnBuilder {
    return this.boolean(column);
  }

  // ============================================================================
  // COLUMN TYPES - DATE/TIME
  // ============================================================================

  /**
   * Add a date column (date only, no time).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public date(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "date");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a datetime column (date and time).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public dateTime(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "dateTime");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a timestamp column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public timestamp(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "timestamp");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a time column (time only, no date).
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public time(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "time");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a year column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public year(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "year");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - JSON & BINARY
  // ============================================================================

  /**
   * Add a JSON column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public json(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "json");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for json().
   */
  public object(column: string): ColumnBuilder {
    return this.json(column);
  }

  /**
   * Add a binary/blob column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public binary(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "binary");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Alias for binary().
   */
  public blob(column: string): ColumnBuilder {
    return this.binary(column);
  }

  // ============================================================================
  // COLUMN TYPES - IDENTIFIERS
  // ============================================================================

  /**
   * Add a UUID column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public uuid(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "uuid");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a ULID column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public ulid(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "ulid");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - NETWORK
  // ============================================================================

  /**
   * Add an IP address column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public ipAddress(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "ipAddress");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a MAC address column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public macAddress(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "macAddress");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - GEO & SPATIAL
  // ============================================================================

  /**
   * Add a geo point column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public point(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "point");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a polygon column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public polygon(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "polygon");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a line string column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public lineString(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "lineString");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a generic geometry column.
   *
   * @param column - Column name
   * @returns Column builder for chaining modifiers
   */
  public geometry(column: string): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "geometry");
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - AI/ML
  // ============================================================================

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
  public vector(column: string, dimensions: number): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "vector", { dimensions });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // COLUMN TYPES - ENUM & SET
  // ============================================================================

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
  public enum(column: string, values: string[]): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "enum", { values });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  /**
   * Add a set column (multiple values from a set).
   *
   * @param column - Column name
   * @param values - Allowed set values
   * @returns Column builder for chaining modifiers
   */
  public set(column: string, values: string[]): ColumnBuilder {
    const builder = new ColumnBuilder(this, column, "set", { values });
    this.pendingOperations.push({
      type: "addColumn",
      payload: builder.getDefinition(),
    });
    return builder;
  }

  // ============================================================================
  // SHORTCUTS
  // ============================================================================

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
  public id(name = "id"): ColumnBuilder {
    return this.integer(name).primary().autoIncrement().unsigned();
  }

  /**
   * Add a big integer auto-increment primary key column.
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   */
  public bigId(name = "id"): ColumnBuilder {
    return this.bigInteger(name).primary().autoIncrement().unsigned();
  }

  /**
   * Add a UUID primary key column.
   *
   * @param name - Column name (default: "id")
   * @returns Column builder for chaining modifiers
   */
  public uuidId(name = "id"): ColumnBuilder {
    return this.uuid(name).primary();
  }

  /**
   * Add createdAt and updatedAt timestamp columns.
   *
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.timestamps(); // Creates createdAt and updatedAt
   * ```
   */
  public timestamps(): this {
    this.dateTime("createdAt");
    this.dateTime("updatedAt");
    return this;
  }

  /**
   * Add a deletedAt column for soft deletes.
   *
   * @param column - Column name (default: "deletedAt")
   * @returns Column builder for chaining modifiers
   */
  public softDeletes(column = "deletedAt"): ColumnBuilder {
    return this.dateTime(column).nullable();
  }

  // ============================================================================
  // DROP COLUMN OPERATIONS
  // ============================================================================

  /**
   * Drop a column.
   *
   * @param column - Column name to drop
   * @returns This migration for chaining
   */
  public dropColumn(column: string): this {
    this.pendingOperations.push({ type: "dropColumn", payload: column });
    return this;
  }

  /**
   * Drop multiple columns.
   *
   * @param columns - Column names to drop
   * @returns This migration for chaining
   */
  public dropColumns(...columns: string[]): this {
    this.pendingOperations.push({ type: "dropColumns", payload: columns });
    return this;
  }

  /**
   * Rename a column.
   *
   * @param from - Current column name
   * @param to - New column name
   * @returns This migration for chaining
   */
  public renameColumn(from: string, to: string): this {
    this.pendingOperations.push({
      type: "renameColumn",
      payload: { from, to },
    });
    return this;
  }

  // ============================================================================
  // INDEX OPERATIONS
  // ============================================================================

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
  public index(
    columns: string | string[],
    name?: string,
    options?: { include?: string[]; concurrently?: boolean },
  ): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({
      type: "createIndex",
      payload: {
        columns: cols,
        name,
        include: options?.include,
        concurrently: options?.concurrently,
      } as IndexDefinition,
    });
    return this;
  }

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
  public dropIndex(nameOrColumns: string | string[]): this {
    this.pendingOperations.push({
      type: "dropIndex",
      payload: nameOrColumns,
    });
    return this;
  }

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
  public unique(
    columns: string | string[],
    name?: string,
    options?: { include?: string[]; concurrently?: boolean },
  ): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({
      type: "createUniqueIndex",
      payload: {
        columns: cols,
        name,
        include: options?.include,
        concurrently: options?.concurrently,
      },
    });
    return this;
  }

  /**
   * Drop a unique constraint/index.
   *
   * @param columns - Columns in the unique constraint
   * @returns This migration for chaining
   */
  public dropUnique(columns: string | string[]): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({ type: "dropUniqueIndex", payload: cols });
    return this;
  }

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
  public expressionIndex(
    expressions: string | string[],
    name?: string,
    options?: { concurrently?: boolean },
  ): this {
    const exprs = Array.isArray(expressions) ? expressions : [expressions];
    this.pendingOperations.push({
      type: "createIndex",
      payload: {
        columns: [], // Empty columns for expression indexes
        expressions: exprs,
        name,
        concurrently: options?.concurrently,
      } as IndexDefinition,
    });
    return this;
  }

  // ============================================================================
  // FULL-TEXT INDEX
  // ============================================================================

  /**
   * Create a full-text search index.
   *
   * @param columns - Column(s) to index
   * @param options - Full-text options
   * @returns This migration for chaining
   */
  public fullText(columns: string | string[], options?: FullTextIndexOptions): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({
      type: "createFullTextIndex",
      payload: { columns: cols, options },
    });
    return this;
  }

  /**
   * Drop a full-text search index.
   *
   * @param name - Index name
   * @returns This migration for chaining
   */
  public dropFullText(name: string): this {
    this.pendingOperations.push({ type: "dropFullTextIndex", payload: name });
    return this;
  }

  // ============================================================================
  // GEO INDEX
  // ============================================================================

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
  public geoIndex(column: string, options?: GeoIndexOptions): this {
    this.pendingOperations.push({
      type: "createGeoIndex",
      payload: { column, options },
    });
    return this;
  }

  /**
   * Drop a geo-spatial index.
   *
   * @param column - Geo column
   * @returns This migration for chaining
   */
  public dropGeoIndex(column: string): this {
    this.pendingOperations.push({ type: "dropGeoIndex", payload: column });
    return this;
  }

  // ============================================================================
  // VECTOR INDEX
  // ============================================================================

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
  public vectorIndex(column: string, options: VectorIndexOptions): this {
    this.pendingOperations.push({
      type: "createVectorIndex",
      payload: { column, options },
    });
    return this;
  }

  /**
   * Drop a vector search index.
   *
   * @param column - Vector column
   * @returns This migration for chaining
   */
  public dropVectorIndex(column: string): this {
    this.pendingOperations.push({ type: "dropVectorIndex", payload: column });
    return this;
  }

  // ============================================================================
  // TTL INDEX
  // ============================================================================

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
  public ttlIndex(column: string, expireAfterSeconds: number): this {
    this.pendingOperations.push({
      type: "createTTLIndex",
      payload: { column, seconds: expireAfterSeconds },
    });
    return this;
  }

  /**
   * Drop a TTL index.
   *
   * @param column - Column with TTL
   * @returns This migration for chaining
   */
  public dropTTLIndex(column: string): this {
    this.pendingOperations.push({ type: "dropTTLIndex", payload: column });
    return this;
  }

  // ============================================================================
  // PRIMARY KEY
  // ============================================================================

  /**
   * Add a composite primary key.
   *
   * @param columns - Columns to include in the primary key
   * @returns This migration for chaining
   */
  public primaryKey(columns: string[]): this {
    this.pendingOperations.push({ type: "addPrimaryKey", payload: columns });
    return this;
  }

  /**
   * Drop the primary key constraint.
   *
   * @returns This migration for chaining
   */
  public dropPrimaryKey(): this {
    this.pendingOperations.push({ type: "dropPrimaryKey", payload: null });
    return this;
  }

  // ============================================================================
  // CHECK CONSTRAINTS
  // ============================================================================

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
  public check(name: string, expression: string): this {
    this.pendingOperations.push({
      type: "addCheck",
      payload: { name, expression },
    });
    return this;
  }

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
  public dropCheck(name: string): this {
    this.pendingOperations.push({
      type: "dropCheck",
      payload: name,
    });
    return this;
  }

  // ============================================================================
  // FOREIGN KEYS (SQL)
  // ============================================================================

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
  public foreign(column: string): ForeignKeyBuilder {
    return new ForeignKeyBuilder(this, column);
  }

  /**
   * Drop a foreign key constraint by name.
   *
   * @param name - Constraint name
   * @returns This migration for chaining
   */
  public dropForeign(name: string): this {
    this.pendingOperations.push({ type: "dropForeignKey", payload: name });
    return this;
  }

  // ============================================================================
  // SCHEMA VALIDATION (NoSQL)
  // ============================================================================

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
  public schemaValidation(schema: object): this {
    this.pendingOperations.push({
      type: "setSchemaValidation",
      payload: schema,
    });
    return this;
  }

  /**
   * Remove schema validation rules from the collection.
   *
   * @returns This migration for chaining
   */
  public dropSchemaValidation(): this {
    this.pendingOperations.push({
      type: "removeSchemaValidation",
      payload: null,
    });
    return this;
  }

  // ============================================================================
  // RAW ACCESS
  // ============================================================================

  /**
   * Execute raw operations with direct driver access.
   *
   * Use this for database-specific operations not covered by the API.
   *
   * @param callback - Callback receiving the native connection
   * @returns Result from callback
   *
   * @example
   * ```typescript
   * await this.raw(async (db) => {
   *   await db.collection("users").updateMany({}, { $set: { active: true } });
   * });
   * ```
   */
  public async raw<T>(callback: (connection: unknown) => Promise<T>): Promise<T> {
    return this.driver.raw(callback);
  }
}

export function migrate(
  model: ChildModel<Model<any>>,
  options?: {
    createdAt?: string;
    name?: string;
    up?: (this: MigrationContract) => void | Promise<void>;
    down?: (this: MigrationContract) => void | Promise<void>;
    transactional?: boolean;
  },
): MigrationConstructor {
  return class AnonymousMigration extends Migration {
    public static migrationName?: string = options?.name;
    public static createdAt?: string = options?.createdAt;
    public readonly table: string = model.table;
    public static transactional?: boolean = options?.transactional;

    public async up() {
      await options?.up?.call(this);
    }

    public async down() {
      await options?.down?.call(this);
    }
  };
}
