import type { ColumnDefinition, ColumnType } from "../contracts/migration-driver.contract";

/**
 * Reference to the Migration type to avoid circular imports.
 * The actual type is injected at runtime.
 */
type MigrationLike = {
  addPendingIndex(index: { columns: string[]; unique?: boolean }): void;
};

/**
 * Fluent builder for defining column properties.
 *
 * Allows chaining modifiers like `.nullable()`, `.unique()`, `.default()`.
 * Each column builder is bound to a parent migration and accumulates
 * the column definition through method chains.
 *
 * @example
 * ```typescript
 * this.string("email")
 *   .nullable()
 *   .unique()
 *   .default("guest@example.com");
 * ```
 *
 * @example
 * ```typescript
 * this.integer("age")
 *   .unsigned()
 *   .comment("User's age in years");
 * ```
 */
export class ColumnBuilder {
  /** Mutable column definition being accumulated */
  private readonly definition: ColumnDefinition;

  /**
   * Create a new column builder.
   *
   * @param migration - Parent migration instance for index registration
   * @param name - Column name
   * @param type - Column data type
   * @param options - Optional initial configuration
   */
  public constructor(
    private readonly migration: MigrationLike,
    name: string,
    type: ColumnType,
    options: Partial<
      Pick<ColumnDefinition, "length" | "precision" | "scale" | "dimensions" | "values">
    > = {},
  ) {
    this.definition = {
      name,
      type,
      nullable: false,
      ...options,
    };
  }

  // ============================================================================
  // NULLABILITY
  // ============================================================================

  /**
   * Mark column as nullable (allows NULL values).
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("middleName").nullable();
   * ```
   */
  public nullable(): this {
    this.definition.nullable = true;
    return this;
  }

  /**
   * Mark column as not nullable (disallows NULL values).
   *
   * This is the default, but can be used for clarity.
   *
   * @returns This builder for chaining
   */
  public notNullable(): this {
    this.definition.nullable = false;
    return this;
  }

  // ============================================================================
  // DEFAULT VALUES
  // ============================================================================

  /**
   * Set default value for the column.
   *
   * @param value - Default value (can be a literal or expression)
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.boolean("isActive").default(true);
   * this.dateTime("createdAt").default("NOW()");
   * ```
   */
  public default(value: unknown): this {
    this.definition.defaultValue = value;
    return this;
  }

  // ============================================================================
  // INDEXES
  // ============================================================================

  /**
   * Add unique constraint/index on this column.
   *
   * Registers a pending unique index with the parent migration.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("email").unique();
   * ```
   */
  public unique(): this {
    this.migration.addPendingIndex({
      columns: [this.definition.name],
      unique: true,
    });
    return this;
  }

  /**
   * Add regular index on this column.
   *
   * Registers a pending index with the parent migration.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("email").index();
   * ```
   */
  public index(): this {
    this.migration.addPendingIndex({
      columns: [this.definition.name],
    });
    return this;
  }

  // ============================================================================
  // PRIMARY KEY & AUTO INCREMENT
  // ============================================================================

  /**
   * Mark as primary key.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("id").primary();
   * ```
   */
  public primary(): this {
    this.definition.primary = true;
    return this;
  }

  /**
   * Mark as auto-increment (numeric types only).
   *
   * SQL databases will use native AUTO_INCREMENT/SERIAL.
   * NoSQL databases ignore this.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("id").primary().autoIncrement();
   * ```
   */
  public autoIncrement(): this {
    this.definition.autoIncrement = true;
    return this;
  }

  // ============================================================================
  // NUMERIC MODIFIERS
  // ============================================================================

  /**
   * Mark as unsigned (numeric types only).
   *
   * Disallows negative values and doubles the positive range.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("age").unsigned();
   * ```
   */
  public unsigned(): this {
    this.definition.unsigned = true;
    return this;
  }

  // ============================================================================
  // METADATA
  // ============================================================================

  /**
   * Add comment/description to column.
   *
   * Stored as column metadata in the database.
   *
   * @param text - Comment text
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("sku").comment("Stock Keeping Unit code");
   * ```
   */
  public comment(text: string): this {
    this.definition.comment = text;
    return this;
  }

  // ============================================================================
  // ACCESSOR
  // ============================================================================

  /**
   * Get the built column definition.
   *
   * Called internally by the Migration class to extract the final definition.
   *
   * @returns The accumulated column definition
   */
  public getDefinition(): ColumnDefinition {
    return this.definition;
  }
}
