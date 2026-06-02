//#region ../../@warlock.js/cascade/src/migration/column-builder.ts
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
var ColumnBuilder = class {
	migration;
	/** Mutable column definition being accumulated */
	definition;
	/** Mutable foreign key definition, set when .references() is called */
	fkDefinition;
	/** Temporary storage for generated expression before .stored() or .virtual() is called */
	generatedExpression;
	/**
	* Create a new column builder.
	*
	* @param migration - Parent migration instance for index registration
	* @param name - Column name
	* @param type - Column data type
	* @param options - Optional initial configuration
	*/
	constructor(migration, name, type, options = {}) {
		this.migration = migration;
		this.definition = {
			name,
			type,
			nullable: false,
			...options
		};
	}
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
	nullable() {
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
	notNullable() {
		this.definition.nullable = false;
		return this;
	}
	/**
	* Set default value for the column as a raw SQL expression.
	*
	* The value will be used as-is in the SQL statement without escaping.
	* Use this for database functions and expressions.
	*
	* @param value - Default value (SQL expression, number, or boolean)
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.uuid("id").default("gen_random_uuid()");
	* this.timestamp("created_at").default("NOW()");
	* this.integer("version").default(1);
	* this.boolean("is_active").default(true);
	* ```
	*/
	default(value) {
		this.definition.defaultValue = value;
		this.definition.isRawDefault = true;
		return this;
	}
	/**
	* Set default value for the column as a literal string.
	*
	* The value will be properly escaped and quoted in the SQL statement.
	* Use this for literal string values, not SQL expressions.
	*
	* @param value - Default string value (will be escaped)
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.text("status").defaultString("active");
	* this.text("greeting").defaultString("Hello, World!");
	* ```
	*/
	defaultString(value) {
		this.definition.defaultValue = value;
		this.definition.isRawDefault = false;
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
	useCurrent() {
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
	useCurrentOnUpdate() {
		this.definition.onUpdateCurrent = true;
		return this;
	}
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
	unique() {
		this.migration.addPendingIndex({
			columns: [this.definition.name],
			unique: true
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
	index() {
		this.migration.addPendingIndex({ columns: [this.definition.name] });
		return this;
	}
	/**
	* Add a vector search index on this column.
	*
	* Registers a pending vector index with the parent migration.
	*
	* @param options - Vector index options
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.vector(1536).vectorIndex({ similarity: "cosine" });
	* ```
	*/
	vectorIndex(options = {}) {
		if (this.migration.addPendingVectorIndex) this.migration.addPendingVectorIndex(this.definition.name, {
			...options,
			dimensions: this.definition.dimensions || 0
		});
		return this;
	}
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
	primary() {
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
	autoIncrement() {
		this.definition.autoIncrement = true;
		return this;
	}
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
	unsigned() {
		this.definition.unsigned = true;
		return this;
	}
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
	comment(text) {
		this.definition.comment = text;
		return this;
	}
	/**
	* Add a CHECK constraint scoped to this column.
	*
	* @param expression - SQL CHECK expression (can reference the column by name)
	* @param name - Constraint name (defaults to `check_<column>`)
	* @returns This builder for chaining
	*/
	check(expression, name) {
		this.definition.checkConstraint = {
			expression,
			name: name ?? `check_${this.definition.name}`
		};
		return this;
	}
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
	after(columnName) {
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
	first() {
		this.definition.first = true;
		return this;
	}
	/**
	* Declare a foreign key constraint on this column.
	*
	* Accepts either a raw table-name string or a Model class (anything with a
	* static `table` property). Using a Model class is preferred — it is
	* type-safe and automatically tracks table renames.
	*
	* Pushes an `addForeignKey` operation immediately using a mutable reference —
	* subsequent `.on()`, `.onDelete()`, `.onUpdate()` calls mutate the same
	* definition that is already queued, so no `.add()` terminator is needed.
	*
	* Referenced column defaults to `"id"` — use `.on()` to override.
	*
	* @param tableOrModel - Referenced table name OR a Model class with a static `table` property
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* // Preferred — model class reference (type-safe, rename-proof)
	* this.uuid("organization_id").references(Organization).onDelete("cascade");
	*
	* // Also supported — raw table string
	* this.uuid("organization_id").references("organizations").onDelete("cascade");
	* this.uuid("organization_id").references(Organization.table).onDelete("cascade");
	* ```
	*/
	references(tableOrModel) {
		const tableName = typeof tableOrModel === "string" ? tableOrModel : tableOrModel.table;
		this.fkDefinition = {
			column: this.definition.name,
			referencesTable: tableName,
			referencesColumn: "id",
			onDelete: "restrict",
			onUpdate: "restrict"
		};
		this.migration.addForeignKeyOperation(this.fkDefinition);
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
	on(column) {
		if (this.fkDefinition) this.fkDefinition.referencesColumn = column;
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
	onDelete(action) {
		if (this.fkDefinition) this.fkDefinition.onDelete = action;
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
	onUpdate(action) {
		if (this.fkDefinition) this.fkDefinition.onUpdate = action;
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
	cascadeAll() {
		if (this.fkDefinition) {
			this.fkDefinition.onDelete = "cascade";
			this.fkDefinition.onUpdate = "cascade";
		}
		return this;
	}
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
	change() {
		const operations = this.migration.pendingOperations;
		const lastOp = operations[operations.length - 1];
		if (lastOp?.type === "addColumn" && lastOp.payload === this.definition) operations.pop();
		let pendingFkOp;
		if (this.fkDefinition) {
			const tail = operations[operations.length - 1];
			if (tail?.type === "addForeignKey" && tail.payload === this.fkDefinition) pendingFkOp = operations.pop();
		}
		operations.push({
			type: "modifyColumn",
			payload: this.definition
		});
		if (pendingFkOp) operations.push(pendingFkOp);
		return this.migration;
	}
	/**
	* @alias change
	*/
	modify() {
		return this.change();
	}
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
	generatedAs(expression) {
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
	stored() {
		if (this.generatedExpression) this.definition.generated = {
			expression: this.generatedExpression,
			stored: true
		};
		return this;
	}
	/**
	* Mark the generated column as virtual (computed on read, not stored).
	*
	* Must be called after `.generatedAs()`. Not supported by PostgreSQL.
	*
	* @returns This builder for chaining
	*/
	virtual() {
		if (this.generatedExpression) this.definition.generated = {
			expression: this.generatedExpression,
			stored: false
		};
		return this;
	}
	/**
	* Get the built column definition.
	*
	* Called internally by the Migration class to extract the final definition.
	*
	* @returns The accumulated column definition
	*/
	getDefinition() {
		return this.definition;
	}
};
//#endregion
export { ColumnBuilder };

//# sourceMappingURL=column-builder.mjs.map