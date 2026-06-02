import { DataSource } from "../data-source/data-source.mjs";
import { dataSourceRegistry } from "../data-source/data-source-registry.mjs";
import { MongoDbDriver } from "../drivers/mongodb/mongodb-driver.mjs";
import { PostgresDriver } from "../drivers/postgres/postgres-driver.mjs";
import "../drivers/postgres/index.mjs";
//#region ../../@warlock.js/cascade/src/utils/connect-to-database.ts
/**
* Connect to a database and register the data source.
*
* This is a high-level utility function that simplifies database connection
* for small to medium projects. It handles driver instantiation, connection,
* data source creation, and automatic registration.
*
* **Supported Drivers:**
* - `mongodb` (default) - MongoDB driver with optional auto ID generation
* - `postgres` - PostgreSQL driver (not yet implemented)
* - `mysql` - MySQL driver (not yet implemented)
*
* **Features:**
* - Automatic driver instantiation based on driver name
* - Connection establishment and error handling
* - DataSource creation and registration
* - Support for MongoDB-specific features (ID generation, transactions)
*
* @param options - Connection configuration options
* @returns A connected and registered DataSource instance
* @throws {Error} If connection fails or driver is not implemented
*
* @example
* ```typescript
* // MongoDB with new structure
* const dataSource = await connectToDatabase({
*   driver: "mongodb",
*   database: "myapp",
*   host: "localhost",
*   port: 27017,
*   driverOptions: {
*     autoGenerateId: true,
*   },
*   clientOptions: {
*     minPoolSize: 5,
*     maxPoolSize: 10,
*   },
*   modelOptions: {
*     randomIncrement: true,
*     initialId: 1000,
*   },
* });
* ```
*/
async function connectToDatabase(options) {
	const driverType = options.driver ?? "mongodb";
	const dataSourceName = options.name ?? "default";
	const isDefault = options.isDefault ?? true;
	let driver;
	switch (driverType) {
		case "mongodb":
			driver = new MongoDbDriver({
				database: options.database,
				uri: options.uri,
				host: options.host,
				port: options.port,
				username: options.username,
				password: options.password,
				authSource: options.authSource,
				logging: options.logging,
				clientOptions: options.clientOptions
			}, options.driverOptions);
			break;
		case "postgres":
			driver = new PostgresDriver({
				database: options.database,
				connectionString: options.uri,
				host: options.host,
				port: options.port ?? 5432,
				user: options.username,
				password: options.password,
				logging: options.logging,
				...options.clientOptions
			});
			break;
		case "mysql": throw new Error("MySQL driver is not yet implemented. Coming soon!");
		default: throw new Error(`Unknown driver: "${driverType}". Supported drivers: mongodb, postgres, mysql`);
	}
	const dataSource = new DataSource({
		name: dataSourceName,
		driver,
		isDefault,
		defaultDeleteStrategy: options.defaultDeleteStrategy,
		defaultTrashTable: options.defaultTrashTable,
		modelDefaults: options.modelOptions,
		migrationDefaults: options.migrationOptions,
		relationDefaults: options.relationOptions,
		migrations: options.migrations
	});
	dataSourceRegistry.register(dataSource);
	try {
		await driver.connect();
	} catch (error) {
		console.log(error);
		throw new Error(`Failed to connect to ${driverType} database: ${error instanceof Error ? error.message : String(error)}`);
	}
	return dataSource;
}
/**
* Get current driver instance.
*
* @example
* ```typescript
* const driver = getDatabaseDriver();
*
* // Pass type to return Postgres driver type
* const pgDriver = getDatabaseDriver<PostgresDriver>();
* ```
*/
function getDatabaseDriver() {
	return dataSourceRegistry.get().driver;
}
/**
* Perform database transaction(s)
* Shorthand to `dataSourceRegister.get().driver.transaction
*/
async function transaction(fn, options) {
	return getDatabaseDriver().transaction(fn, options);
}
//#endregion
export { connectToDatabase, getDatabaseDriver, transaction };

//# sourceMappingURL=connect-to-database.mjs.map