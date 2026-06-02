//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-sync-adapter.ts
/**
* PostgreSQL Sync Adapter.
*
* Handles batch updates for embedded/denormalized data stored
* in JSONB columns. In a normalized SQL world, this is less common
* than in MongoDB, but still useful for JSONB documents.
*
* @example
* ```typescript
* const syncAdapter = driver.syncAdapter();
*
* // Update embedded user data in posts
* await syncAdapter.executeBatch([
*   {
*     targetTable: 'posts',
*     filter: { 'author.id': 123 },
*     update: { 'author.name': 'New Name' },
*     // ... other fields
*   }
* ]);
* ```
*/
var PostgresSyncAdapter = class {
	driver;
	/**
	* Create a new sync adapter.
	*
	* @param driver - The PostgreSQL driver instance
	*/
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Execute a batch of sync instructions.
	*
	* @param instructions - Array of sync instructions
	* @returns Total number of affected rows
	*/
	async executeBatch(instructions) {
		let totalAffected = 0;
		for (const instruction of instructions) if (instruction.isArrayUpdate) totalAffected += await this.executeArrayUpdate(instruction);
		else totalAffected += await this.executeOne(instruction);
		return totalAffected;
	}
	/**
	* Execute a single sync instruction.
	*
	* @param instruction - Sync instruction
	* @returns Number of affected rows
	*/
	async executeOne(instruction) {
		const { targetTable, filter, update } = instruction;
		return this.executeJsonbUpdate(targetTable, filter, update);
	}
	/**
	* Execute an array update instruction with positional operators.
	*
	* @param instruction - Sync instruction with array update info
	* @returns Number of affected rows
	*/
	async executeArrayUpdate(instruction) {
		const { targetTable, filter, update, arrayField, identifierField, identifierValue } = instruction;
		if (!arrayField || !identifierField || identifierValue === void 0) return this.executeOne(instruction);
		return this.executeArrayElementUpdate(targetTable, filter, arrayField, { [identifierField]: identifierValue }, update);
	}
	/**
	* Execute an update on JSONB fields.
	*
	* @param table - Table name
	* @param filter - Row filter
	* @param update - Fields to update
	* @returns Number of affected rows
	*/
	async executeJsonbUpdate(table, filter, update) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const setClauses = [];
		const params = [];
		let paramIndex = 1;
		for (const [path, value] of Object.entries(update)) if (path.includes(".")) {
			const [column, ...pathParts] = path.split(".");
			const quotedColumn = this.driver.dialect.quoteIdentifier(column);
			const jsonPath = `{${pathParts.join(",")}}`;
			const placeholder = this.driver.dialect.placeholder(paramIndex++);
			params.push(JSON.stringify(value));
			setClauses.push(`${quotedColumn} = jsonb_set(COALESCE(${quotedColumn}, '{}'::jsonb), '${jsonPath}', ${placeholder}::jsonb)`);
		} else {
			const quotedColumn = this.driver.dialect.quoteIdentifier(path);
			const placeholder = this.driver.dialect.placeholder(paramIndex++);
			params.push(value);
			setClauses.push(`${quotedColumn} = ${placeholder}`);
		}
		const whereClauses = [];
		for (const [key, value] of Object.entries(filter)) if (key.includes(".")) {
			const [column, ...pathParts] = key.split(".");
			const quotedColumn = this.driver.dialect.quoteIdentifier(column);
			const intermediateExpr = pathParts.slice(0, -1).map((p) => `->'${p}'`).join("");
			const finalExpr = `->>'${pathParts[pathParts.length - 1]}'`;
			const placeholder = this.driver.dialect.placeholder(paramIndex++);
			params.push(value);
			whereClauses.push(`${quotedColumn}${intermediateExpr}${finalExpr} = ${placeholder}`);
		} else {
			const quotedKey = this.driver.dialect.quoteIdentifier(key);
			const placeholder = this.driver.dialect.placeholder(paramIndex++);
			params.push(value);
			whereClauses.push(`${quotedKey} = ${placeholder}`);
		}
		const sql = `UPDATE ${quotedTable} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
		return (await this.driver.query(sql, params)).rowCount ?? 0;
	}
	/**
	* Execute an update on elements within a JSONB array.
	*
	* @param table - Table name
	* @param filter - Row filter
	* @param arrayField - JSONB array column
	* @param arrayFilter - Filter to match array elements
	* @param update - Fields to update on matched elements
	* @returns Number of affected rows
	*/
	async executeArrayElementUpdate(table, filter, arrayField, arrayFilter, update) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedArrayField = this.driver.dialect.quoteIdentifier(arrayField);
		const params = [];
		let paramIndex = 1;
		const sql = `
      WITH updated AS (
        SELECT ctid, (
          SELECT jsonb_agg(
            CASE
              WHEN ${Object.entries(arrayFilter).map(([key, value]) => {
			params.push(value);
			return `elem->>'${key}' = ${this.driver.dialect.placeholder(paramIndex++)}`;
		}).join(" AND ")}
              THEN elem || jsonb_build_object(${Object.entries(update).map(([key, value]) => {
			params.push(JSON.stringify(value));
			return `'${key}', ${this.driver.dialect.placeholder(paramIndex++)}::jsonb`;
		}).join(", ")})
              ELSE elem
            END
          )
          FROM jsonb_array_elements(${quotedArrayField}) elem
        ) AS new_array
        FROM ${quotedTable}
        WHERE ${Object.entries(filter).map(([key, value]) => {
			const quotedKey = this.driver.dialect.quoteIdentifier(key);
			params.push(value);
			return `${quotedKey} = ${this.driver.dialect.placeholder(paramIndex++)}`;
		}).join(" AND ")}
      )
      UPDATE ${quotedTable} t
      SET ${quotedArrayField} = u.new_array
      FROM updated u
      WHERE t.ctid = u.ctid
    `;
		return (await this.driver.query(sql, params)).rowCount ?? 0;
	}
};
//#endregion
export { PostgresSyncAdapter };

//# sourceMappingURL=postgres-sync-adapter.mjs.map