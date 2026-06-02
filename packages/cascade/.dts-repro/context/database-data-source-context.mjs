import { Context, contextManager } from "@warlock.js/context";
//#region ../../@warlock.js/cascade/src/context/database-data-source-context.ts
/**
* Database DataSource Context
*
* Manages the active database connection/data source using AsyncLocalStorage.
* Extends the base Context class for consistent API.
*/
var DatabaseDataSourceContext = class extends Context {
	/**
	* Get the current data source
	*/
	getDataSource() {
		return this.get("dataSource");
	}
	/**
	* Set the data source in context
	*/
	setDataSource(dataSource) {
		this.set("dataSource", dataSource);
	}
	/**
	* Build the initial data source store with defaults
	*/
	buildStore() {
		return { dataSource: void 0 };
	}
};
const databaseDataSourceContext = new DatabaseDataSourceContext();
contextManager.register("db.datasource", databaseDataSourceContext);
//#endregion
export { databaseDataSourceContext };

//# sourceMappingURL=database-data-source-context.mjs.map