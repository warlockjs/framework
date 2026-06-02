import { DatabaseDirtyTracker } from "./database-dirty-tracker.mjs";
//#region ../../@warlock.js/cascade/src/sql-database-dirty-tracker.ts
/**
* A dirty tracker designed for SQL databases where nested objects shouldn't be flattened.
* Since SQL drivers (like Postgres) replace the entire JSON column when updated,
* we keep the object intact instead of using dot-notation keys.
*/
var SqlDatabaseDirtyTracker = class extends DatabaseDirtyTracker {
	/**
	* Overrides the default flattening behavior to keep the raw data structure.
	*/
	flattenData(data) {
		return { ...data };
	}
};
//#endregion
export { SqlDatabaseDirtyTracker };

//# sourceMappingURL=sql-database-dirty-tracker.mjs.map