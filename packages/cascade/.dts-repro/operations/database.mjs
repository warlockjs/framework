import { dataSourceRegistry } from "../data-source/data-source-registry.mjs";
//#region ../../@warlock.js/cascade/src/operations/database.ts
/**
* Create a database on the configured data source. Returns `created: false`
* when the database already exists — drivers are responsible for the
* idempotency check.
*
* @example
* await createDatabase("analytics");
* await createDatabase("analytics", { connection: "warehouse" });
*/
async function createDatabase(name, options = {}) {
	return {
		created: await dataSourceRegistry.get(options.connection).driver.createDatabase(name),
		name
	};
}
/**
* Drop every table on the configured data source. Lists tables first so the
* caller receives the names that were affected — useful for printing,
* confirmation prompts, or audit logging at the call site.
*
* @example
* const { tables, dropped } = await dropAllTables();
* console.log(`Dropped ${dropped} tables: ${tables.join(", ")}`);
*/
async function dropAllTables(options = {}) {
	const driver = dataSourceRegistry.get(options.connection).driver;
	const tables = await driver.blueprint.listTables();
	await driver.dropAllTables();
	return {
		tables,
		dropped: tables.length
	};
}
//#endregion
export { createDatabase, dropAllTables };

//# sourceMappingURL=database.mjs.map