//#region ../../@warlock.js/cascade/src/migration/sql-serializer.ts
/**
* Converts PendingOperation objects to SQL strings for a specific dialect.
*/
var SQLSerializer = class {
	/**
	* Serialize an array of operations to a flat list of SQL strings.
	*
	* Array results from serialize() are automatically flattened, and nulls
	* (no-ops) are filtered out.
	*/
	serializeAll(operations, table) {
		const result = [];
		for (const op of operations) {
			const sql = this.serialize(op, table);
			if (sql === null) continue;
			if (Array.isArray(sql)) result.push(...sql);
			else result.push(sql);
		}
		return result;
	}
};
//#endregion
export { SQLSerializer };

//# sourceMappingURL=sql-serializer.mjs.map