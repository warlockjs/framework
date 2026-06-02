//#region ../../@warlock.js/cascade/src/migration/foreign-key-builder.ts
/**
* Fluent builder for foreign key constraints.
*
* Allows building foreign key definitions with a chainable API.
* SQL-only feature; NoSQL drivers ignore foreign keys.
*
* The operation is pushed when `.references()` is called using a mutable
* reference — subsequent `.onDelete()` / `.onUpdate()` calls mutate the
* same definition already queued in pendingOperations.
*
* @example
* ```typescript
* this.foreign("user_id")
*   .references("users", "id")
*   .onDelete("cascade")
*   .onUpdate("cascade");
* ```
*/
var ForeignKeyBuilder = class {
	migration;
	/** Mutable foreign key definition being accumulated */
	definition;
	/**
	* Create a new foreign key builder.
	*
	* @param migration - Parent migration instance
	* @param column - Local column name that will reference another table
	*/
	constructor(migration, column) {
		this.migration = migration;
		this.definition = {
			column,
			referencesTable: "",
			referencesColumn: "id",
			onDelete: "restrict",
			onUpdate: "restrict"
		};
	}
	/**
	* Set the constraint name.
	*
	* @param name - Constraint name (auto-generated if not provided)
	* @returns This builder for chaining
	*/
	name(name) {
		this.definition.name = name;
		return this;
	}
	/**
	* Set the referenced table and column, and register the foreign key operation.
	*
	* Pushes the operation immediately using a mutable reference — any
	* `.onDelete()` / `.onUpdate()` calls after this will mutate the same
	* definition already queued in pendingOperations.
	*
	* @param table - Referenced table name
	* @param column - Referenced column name (default: "id")
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.foreign("user_id").references("users", "id");
	* this.foreign("category_id").references("categories"); // defaults to "id"
	* ```
	*/
	references(table, column = "id") {
		this.definition.referencesTable = table;
		this.definition.referencesColumn = column;
		this.migration.addForeignKeyOperation(this.definition);
		return this;
	}
	/**
	* Set the ON DELETE action.
	*
	* @param action - Action to take when referenced row is deleted
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.foreign("user_id")
	*   .references("users")
	*   .onDelete("cascade"); // Delete child when parent is deleted
	* ```
	*/
	onDelete(action) {
		this.definition.onDelete = action;
		return this;
	}
	/**
	* Set the ON UPDATE action.
	*
	* @param action - Action to take when referenced row's key is updated
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.foreign("user_id")
	*   .references("users")
	*   .onUpdate("cascade"); // Update child when parent key changes
	* ```
	*/
	onUpdate(action) {
		this.definition.onUpdate = action;
		return this;
	}
	/**
	* Shorthand for `.onDelete("cascade").onUpdate("cascade")`.
	*
	* @returns This builder for chaining
	*
	* @example
	* ```typescript
	* this.foreign("user_id").references("users").cascadeAll();
	* ```
	*/
	cascadeAll() {
		this.definition.onDelete = "cascade";
		this.definition.onUpdate = "cascade";
		return this;
	}
};
//#endregion
export { ForeignKeyBuilder };

//# sourceMappingURL=foreign-key-builder.mjs.map