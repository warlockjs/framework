//#region ../../@warlock.js/cascade/src/data-source/data-source.ts
/**
* Wrapper that couples a driver with its metadata.
*
* A data source represents a database connection with all its associated services.
* The ID generator (if needed) is provided by the driver itself.
*
* @example
* ```typescript
* // MongoDB with auto ID generation
* const mongoDriver = new MongoDbDriver({
*   host: "localhost",
*   port: 27017,
*   database: "myapp",
*   autoGenerateId: true, // Driver creates its own ID generator
* });
*
* const dataSource = new DataSource({
*   name: "primary",
*   driver: mongoDriver,
*   isDefault: true,
* });
*
* // Access ID generator from driver
* const idGenerator = dataSource.idGenerator;
* ```
*/
var DataSource = class {
	/** Unique name identifying this data source. */
	name;
	/** Database driver for executing queries. */
	driver;
	/** Whether this is the default data source. */
	isDefault;
	/** Default delete strategy for models using this data source. */
	defaultDeleteStrategy;
	/** Default trash table/collection name for "trash" delete strategy. */
	defaultTrashTable;
	/** Default model configuration for all models using this data source. */
	modelDefaults;
	/** Migration-level defaults (UUID strategy, etc.). */
	migrationDefaults;
	/** Default relation conventions (FK suffix, pivot ordering). */
	relationDefaults;
	/** Migration configuration options. */
	migrations;
	/**
	* Create a new data source.
	*
	* @param options - Configuration options
	*/
	constructor(options) {
		this.name = options.name;
		this.driver = options.driver;
		this.isDefault = Boolean(options.isDefault);
		this.defaultDeleteStrategy = options.defaultDeleteStrategy;
		this.defaultTrashTable = options.defaultTrashTable;
		this.modelDefaults = options.modelDefaults;
		this.migrationDefaults = options.migrationDefaults;
		this.relationDefaults = options.relationDefaults;
		this.migrations = options.migrations;
	}
	/**
	* Get the ID generator from the driver (if available).
	*
	* NoSQL drivers like MongoDB can provide their own ID generator.
	* SQL drivers return undefined as they use native AUTO_INCREMENT.
	*
	* @returns The ID generator instance, or undefined
	*
	* @example
	* ```typescript
	* const idGenerator = dataSource.idGenerator;
	* if (idGenerator) {
	*   const id = await idGenerator.generateNextId({ table: "users" });
	* }
	* ```
	*/
	get idGenerator() {
		const driver = this.driver;
		if (typeof driver.getIdGenerator === "function") return driver.getIdGenerator();
	}
};
//#endregion
export { DataSource };

//# sourceMappingURL=data-source.mjs.map