import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  FullTextIndexOptions,
  GeoIndexOptions,
  IndexDefinition,
  MigrationDriverContract,
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
  | "createTable"
  | "createTableIfNotExists"
  | "dropTable"
  | "dropTableIfExists"
  | "renameTable"
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
export abstract class Migration {
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

  /**
   * Pending indexes from column builders.
   */
  private readonly pendingIndexes: IndexDefinition[] = [];

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
  public static for<T extends ChildModel<Model>>(model: T): typeof Migration {
    abstract class BoundMigration extends Migration {
      public readonly table = model.table;
      public readonly dataSource = model.dataSource;
    }

    return BoundMigration;
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
    // Execute column/table operations
    for (const op of this.pendingOperations) {
      await this.executeOperation(op);
    }

    // Execute pending indexes from column builders
    for (const index of this.pendingIndexes) {
      if (index.unique) {
        await this.driver.createUniqueIndex(this.table, index.columns, index.name);
      } else {
        await this.driver.createIndex(this.table, index);
      }
    }

    // Clear pending operations after execution
    this.pendingOperations.length = 0;
    this.pendingIndexes.length = 0;
  }

  /**
   * Execute a single pending operation.
   */
  private async executeOperation(op: PendingOperation): Promise<void> {
    switch (op.type) {
      case "addColumn":
        await this.driver.addColumn(this.table, op.payload as ColumnDefinition);
        break;

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

      case "setSchemaValidation":
        await this.driver.setSchemaValidation(this.table, op.payload as object);
        break;

      case "removeSchemaValidation":
        await this.driver.removeSchemaValidation(this.table);
        break;
    }
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Add a pending index definition.
   *
   * Called by ColumnBuilder when .unique() or .index() is chained.
   *
   * @param index - Index definition
   * @internal
   */
  public addPendingIndex(index: IndexDefinition): void {
    this.pendingIndexes.push(index);
  }

  /**
   * Add a foreign key operation.
   *
   * Called by ForeignKeyBuilder when .add() is called.
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
   * @returns This migration for chaining
   *
   * @example
   * ```typescript
   * this.index("email");
   * this.index(["firstName", "lastName"], "name_idx");
   * ```
   */
  public index(columns: string | string[], name?: string): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({
      type: "createIndex",
      payload: { columns: cols, name } as IndexDefinition,
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
   * @returns This migration for chaining
   */
  public unique(columns: string | string[], name?: string): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.pendingOperations.push({
      type: "createUniqueIndex",
      payload: { columns: cols, name },
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
  // FOREIGN KEYS (SQL)
  // ============================================================================

  /**
   * Start building a foreign key constraint.
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
   *   .onDelete("cascade")
   *   .add();
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
    up?: (this: Migration) => void;
    down?: (this: Migration) => void;
    transactional?: boolean;
  },
) {
  return class AnonymousMigration extends Migration {
    public static migrationName?: string = options?.name;
    public static createdAt?: string = options?.createdAt;
    public readonly table: string = model.table;
    public static transactional?: boolean = options?.transactional;

    public async up() {
      options?.up?.call(this);
    }

    public async down() {
      options?.down?.call(this);
    }
  };
}
