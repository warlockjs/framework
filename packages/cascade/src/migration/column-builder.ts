import type { ColumnDefinition, ColumnType, ForeignKeyDefinition } from "../contracts/migration-driver.contract";

/**
 * Reference to the Migration type to avoid circular imports.
 * The actual type is injected at runtime.
 */
type MigrationLike = {
  addPendingIndex(index: { columns: string[]; unique?: boolean }): void;
  addForeignKeyOperation(fk: ForeignKeyDefinition): void;
};

/**
 * Mutable foreign key definition being built via ColumnBuilder.
 */
interface MutableForeignKeyDefinition {
  name?: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete: ForeignKeyDefinition["onDelete"];
  onUpdate: ForeignKeyDefinition["onUpdate"];
}

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

  /** Mutable foreign key definition, set when .references() is called */
  private fkDefinition?: MutableForeignKeyDefinition;

  /** Temporary storage for generated expression before .stored() or .virtual() is called */
  private generatedExpression?: string;

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

  /**
   * Set default value to the current timestamp.
   *
   * Database-agnostic. Generates NOW() / CURRENT_TIMESTAMP / GETDATE() based on driver.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.timestamp("created_at").useCurrent();
   * ```
   */
  public useCurrent(): this {
    this.definition.defaultValue = { __type: "CURRENT_TIMESTAMP" };
    return this;
  }

  /**
   * Set column to update to current timestamp on row update.
   *
   * MySQL only. Other databases ignore this.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.timestamp("updated_at").useCurrent().useCurrentOnUpdate();
   * ```
   */
  public useCurrentOnUpdate(): this {
    this.definition.onUpdateCurrent = true;
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
  // CONSTRAINTS
  // ============================================================================

  /**
   * Add a CHECK constraint scoped to this column.
   *
   * @param expression - SQL CHECK expression (can reference the column by name)
   * @param name - Constraint name (defaults to `check_<column>`)
   * @returns This builder for chaining
   */
  public check(expression: string, name?: string): this {
    this.definition.checkConstraint = {
      expression,
      name: name ?? `check_${this.definition.name}`,
    };
    return this;
  }

  // ============================================================================
  // COLUMN POSITIONING (MySQL/MariaDB only)
  // ============================================================================

  /**
   * Position this column after another column.
   *
   * MySQL/MariaDB only. Ignored by PostgreSQL and NoSQL drivers.
   *
   * @param columnName - Column to position after
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("middle_name").after("first_name");
   * ```
   */
  public after(columnName: string): this {
    this.definition.after = columnName;
    return this;
  }

  /**
   * Position this column as the first column in the table.
   *
   * MySQL/MariaDB only. Ignored by PostgreSQL and NoSQL drivers.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("id").primary().first();
   * ```
   */
  public first(): this {
    this.definition.first = true;
    return this;
  }

  // ============================================================================
  // FOREIGN KEY
  // ============================================================================

  /**
   * Declare a foreign key constraint on this column.
   *
   * Pushes an `addForeignKey` operation immediately using a mutable reference —
   * subsequent `.on()`, `.onDelete()`, `.onUpdate()` calls mutate the same
   * definition that is already queued, so no `.add()` terminator is needed.
   *
   * Referenced column defaults to `"id"` — use `.on()` to override.
   *
   * @param table - Referenced table name
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("user_id").references("users");
   * this.integer("user_id").references("users").on("custom_id").onDelete("cascade");
   * ```
   */
  public references(table: string): this {
    this.fkDefinition = {
      column: this.definition.name,
      referencesTable: table,
      referencesColumn: "id",
      onDelete: "restrict",
      onUpdate: "restrict",
    };
    this.migration.addForeignKeyOperation(this.fkDefinition as ForeignKeyDefinition);
    return this;
  }

  /**
   * Set the referenced column for the foreign key.
   *
   * Only meaningful after `.references()`. Defaults to `"id"` if omitted.
   *
   * @param column - Referenced column name
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("user_id").references("users").on("custom_id");
   * ```
   */
  public on(column: string): this {
    if (this.fkDefinition) {
      this.fkDefinition.referencesColumn = column;
    }
    return this;
  }

  /**
   * Set the ON DELETE action for the foreign key.
   *
   * Only meaningful after `.references()`.
   *
   * @param action - Action when the referenced row is deleted
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("user_id").references("users").onDelete("cascade");
   * ```
   */
  public onDelete(action: ForeignKeyDefinition["onDelete"]): this {
    if (this.fkDefinition) {
      this.fkDefinition.onDelete = action;
    }
    return this;
  }

  /**
   * Set the ON UPDATE action for the foreign key.
   *
   * Only meaningful after `.references()`.
   *
   * @param action - Action when the referenced row's key is updated
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("user_id").references("users").onUpdate("cascade");
   * ```
   */
  public onUpdate(action: ForeignKeyDefinition["onUpdate"]): this {
    if (this.fkDefinition) {
      this.fkDefinition.onUpdate = action;
    }
    return this;
  }

  /**
   * Shorthand for `.onDelete("cascade").onUpdate("cascade")`.
   *
   * Only meaningful after `.references()`.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.integer("user_id").references("users").cascadeAll();
   * ```
   */
  public cascadeAll(): this {
    if (this.fkDefinition) {
      this.fkDefinition.onDelete = "cascade";
      this.fkDefinition.onUpdate = "cascade";
    }
    return this;
  }

  // ============================================================================
  // COLUMN MODIFICATION
  // ============================================================================

  /**
   * Mark this column definition as a modification of an existing column.
   *
   * Pushes a `modifyColumn` operation instead of `addColumn`.
   * This method breaks the builder chain and returns the parent migration.
   *
   * @returns The parent migration instance (breaks builder chain)
   *
   * @example
   * ```typescript
   * // Make email nullable
   * this.string("email").nullable().change();
   *
   * // Increase length
   * this.string("name", 255).change();
   *
   * // Change type
   * this.text("description").change();
   * ```
   */
  public change(): unknown {
    // Remove the existing addColumn operation that was pushed in the constructor
    const operations = (this.migration as any).pendingOperations;
    const lastOp = operations[operations.length - 1];

    if (lastOp?.type === "addColumn" && lastOp.payload === this.definition) {
      operations.pop();
    }

    // Push modifyColumn instead
    (this.migration as any).pendingOperations.push({
      type: "modifyColumn",
      payload: this.definition,
    });

    return this.migration;
  }

  // ============================================================================
  // GENERATED COLUMNS
  // ============================================================================

  /**
   * Mark this column as a generated column with the given SQL expression.
   *
   * Must be followed by `.stored()` or `.virtual()` to specify storage type.
   *
   * PostgreSQL: GENERATED ALWAYS AS (...) STORED
   * MySQL: GENERATED ALWAYS AS (...) STORED | VIRTUAL
   *
   * @param expression - SQL expression to compute the value
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * this.string("full_name")
   *   .generatedAs("CONCAT(first_name, ' ', last_name)")
   *   .stored();
   *
   * this.decimal("price_with_tax")
   *   .generatedAs("price * 1.2")
   *   .virtual();
   * ```
   */
  public generatedAs(expression: string): this {
    this.generatedExpression = expression;
    return this;
  }

  /**
   * Mark the generated column as stored (computed and persisted to disk).
   *
   * Must be called after `.generatedAs()`.
   *
   * @returns This builder for chaining
   */
  public stored(): this {
    if (this.generatedExpression) {
      this.definition.generated = {
        expression: this.generatedExpression,
        stored: true,
      };
    }
    return this;
  }

  /**
   * Mark the generated column as virtual (computed on read, not stored).
   *
   * Must be called after `.generatedAs()`. Not supported by PostgreSQL.
   *
   * @returns This builder for chaining
   */
  public virtual(): this {
    if (this.generatedExpression) {
      this.definition.generated = {
        expression: this.generatedExpression,
        stored: false,
      };
    }
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
