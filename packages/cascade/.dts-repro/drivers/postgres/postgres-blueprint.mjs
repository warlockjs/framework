//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-blueprint.ts
/**
* PostgreSQL Blueprint.
*
* Provides methods for introspecting the database schema
* via PostgreSQL's information_schema and pg_catalog.
*
* @example
* ```typescript
* const blueprint = driver.blueprint;
*
* // Get all tables
* const tables = await blueprint.listTables();
*
* // Get columns for a table
* const columns = await blueprint.listColumns('users');
* ```
*/
var PostgresBlueprint = class {
	driver;
	/**
	* Create a new blueprint.
	*
	* @param driver - The PostgreSQL driver instance
	*/
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Get all table names in the database.
	*
	* @returns Array of table names
	*/
	async listTables() {
		return (await this.driver.query(`SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE'
       ORDER BY table_name`)).rows.map((row) => row.table_name);
	}
	/**
	* Get all indexes for a table.
	*
	* @param table - Table name
	* @returns Array of index information
	*/
	async listIndexes(table) {
		return (await this.driver.query(`SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
       AND tablename = $1`, [table])).rows.map((row) => {
			const isUnique = row.indexdef.includes("UNIQUE");
			const isPrimary = row.indexname.endsWith("_pkey");
			const columnsMatch = row.indexdef.match(/\(([^)]+)\)/);
			const columns = columnsMatch ? columnsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];
			let type = "btree";
			if (row.indexdef.includes("USING GIN")) type = "gin";
			else if (row.indexdef.includes("USING GIST")) type = "gist";
			else if (row.indexdef.includes("USING HASH")) type = "hash";
			else if (row.indexdef.includes("USING ivfflat")) type = "ivfflat";
			const isPartial = row.indexdef.includes("WHERE");
			return {
				name: row.indexname,
				columns,
				type,
				unique: isUnique || isPrimary,
				partial: isPartial,
				options: {
					primary: isPrimary,
					definition: row.indexdef
				}
			};
		});
	}
	/**
	* Get all column names for a table.
	*
	* @param table - Table name
	* @returns Array of column names
	*/
	async listColumns(table) {
		return (await this.driver.query(`SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
       AND table_name = $1
       ORDER BY ordinal_position`, [table])).rows.map((row) => row.column_name);
	}
	/**
	* Check if a table exists.
	*
	* @param table - Table name
	* @returns Whether the table exists
	*/
	async tableExists(table) {
		return (await this.driver.query(`SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`, [table])).rows[0]?.exists ?? false;
	}
};
//#endregion
export { PostgresBlueprint };

//# sourceMappingURL=postgres-blueprint.mjs.map