import { databaseTransactionContext } from "../../context/database-transaction-context.mjs";
import { dataSourceRegistry } from "../../data-source/data-source-registry.mjs";
import { TransactionRollbackError } from "../../errors/transaction-rollback.error.mjs";
import { DatabaseDirtyTracker } from "../../database-dirty-tracker.mjs";
import { isValidDateValue } from "../../utils/is-valid-date-value.mjs";
import { MongoDBBlueprint } from "./mongodb-blueprint.mjs";
import { MongoIdGenerator } from "./mongodb-id-generator.mjs";
import { MongoMigrationDriver } from "./mongodb-migration-driver.mjs";
import { MongoQueryBuilder } from "./mongodb-query-builder.mjs";
import { MongoSyncAdapter } from "./mongodb-sync-adapter.mjs";
import { EventEmitter } from "node:events";
import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-driver.ts
const DEFAULT_TRANSACTION_OPTIONS = {
	readPreference: "primary",
	readConcern: { level: "local" },
	writeConcern: { w: "majority" }
};
/**
* Cached MongoDB module (loaded once, reused)
*/
let MongoDBClient;
let ObjectId;
let isModuleExists = null;
let loadingPromise;
/**
* Installation instructions for MongoDB package
*/
const MONGODB_INSTALL_INSTRUCTIONS = `
MongoDB driver requires the mongodb package.
Install it with:

  npm install mongodb

Or with your preferred package manager:

  pnpm add mongodb
  yarn add mongodb
`.trim();
/**
* Load MongoDB module
*/
async function loadMongoDB() {
	try {
		loadingPromise = import("mongodb");
		MongoDBClient = await loadingPromise;
		ObjectId = MongoDBClient.ObjectId;
		isModuleExists = true;
	} catch {
		isModuleExists = false;
	}
}
loadMongoDB();
function isMongoDBDriverLoaded() {
	return isModuleExists;
}
async function assertModuleIsLoaded() {
	if (isModuleExists === false) throw new Error(MONGODB_INSTALL_INSTRUCTIONS);
	if (isModuleExists === null) {
		await loadingPromise;
		return await assertModuleIsLoaded();
	}
}
/**
* MongoDB driver implementation that fulfils the Cascade driver contract.
*
* It encapsulates the native Mongo client, exposes lifecycle events, and
* provides helpers for CRUD, transactions, atomic updates, and sync adapters.
*/
var MongoDbDriver = class {
	config;
	driverOptions;
	events = new EventEmitter();
	client;
	database;
	connected = false;
	syncAdapterInstance;
	migrationDriverInstance;
	transactionOptions;
	idGeneratorInstance;
	_blueprint;
	get blueprint() {
		if (!this._blueprint) this._blueprint = new MongoDBBlueprint(this.database);
		return this._blueprint;
	}
	/**
	* The name of this driver.
	*/
	name = "mongodb";
	/**
	* Current database name
	*/
	_databaseName;
	/**
	* MongoDB driver model defaults.
	*
	* MongoDB follows NoSQL conventions:
	* - camelCase naming for fields (createdAt, updatedAt, deletedAt)
	* - Manual ID generation (auto-increment id field separate from _id)
	* - Timestamps enabled by default
	* - Trash delete strategy with per-collection trash tables
	*/
	modelDefaults = {
		namingConvention: "camelCase",
		createdAtColumn: "createdAt",
		updatedAtColumn: "updatedAt",
		deletedAtColumn: "deletedAt",
		timestamps: true,
		autoGenerateId: true,
		strictMode: "strip",
		deleteStrategy: "trash",
		trashTable: (table) => `${table}Trash`
	};
	/**
	* Create a new MongoDB driver using the supplied connection options.
	*
	* @param config - Connection configuration
	* @param driverOptions - Driver-specific options
	*/
	constructor(config, driverOptions) {
		this.config = config;
		this.driverOptions = driverOptions;
		this.transactionOptions = {
			...DEFAULT_TRANSACTION_OPTIONS,
			...driverOptions?.transactionOptions
		};
	}
	/**
	* Get data base name
	*/
	get databaseName() {
		if (!this._databaseName) this.resolveDatabaseName();
		return this._databaseName;
	}
	/**
	* Resolve database name either from config or uri
	*/
	resolveDatabaseName() {
		if (this.config.database) this._databaseName = this.config.database;
		else if (this.config.uri) this._databaseName = this.config.uri.split("/").pop()?.split("?")?.[0];
	}
	/**
	* Indicates whether the driver currently maintains an active connection.
	*/
	get isConnected() {
		return this.connected;
	}
	/**
	* Get the MongoDB database instance.
	*
	* @returns The MongoDB Db instance
	* @throws {Error} If not connected
	*
	* @example
	* ```typescript
	* const db = driver.getDatabase();
	* const collection = db.collection("users");
	* ```
	*/
	getDatabase() {
		if (!this.database) throw new Error("Database not available. Ensure the driver is connected before accessing the database.");
		return this.database;
	}
	/**
	* Get the ID generator instance for this driver.
	*
	* Creates a MongoIdGenerator on first access if autoGenerateId is enabled.
	*
	* @returns The ID generator instance, or undefined if disabled
	*
	* @example
	* ```typescript
	* const idGenerator = driver.getIdGenerator();
	* if (idGenerator) {
	*   const id = await idGenerator.generateNextId({ table: "users" });
	* }
	* ```
	*/
	getIdGenerator() {
		if (this.driverOptions?.autoGenerateId === false) return;
		if (!this.idGeneratorInstance) this.idGeneratorInstance = new MongoIdGenerator(this, this.driverOptions?.counterCollection);
		return this.idGeneratorInstance;
	}
	/**
	* Establish a MongoDB connection using the configured options.
	* Throws if the connection attempt fails.
	*/
	async connect() {
		if (this.connected) return;
		await assertModuleIsLoaded();
		const uri = this.resolveUri();
		const { MongoClient, ObjectId: ObjectIdMongoDB } = MongoDBClient;
		ObjectId = ObjectIdMongoDB;
		const client = new MongoClient(uri, this.buildClientOptions());
		try {
			log.info("database.mongodb", "connection", `Connecting to database ${colors.bold(colors.yellowBright(this.databaseName))}`);
			await client.connect();
			this.client = client;
			this.database = client.db(this.databaseName);
			this.connected = true;
			log.success("database.mongodb", "connection", "Connected to database");
			client.on("close", () => {
				if (this.connected) {
					this.connected = false;
					this.emit("disconnected");
					log.warn("database.mongodb", "connection", "Disconnected from database");
				}
			});
			if (this.config.logging) {
				const ignoredCommands = [
					"isMaster",
					"hello",
					"ping",
					"saslStart",
					"saslContinue"
				];
				client.on("commandStarted", (event) => {
					if (ignoredCommands.includes(event.commandName)) return;
					let cmdStr = JSON.stringify(event.command);
					if (cmdStr.length > 300) cmdStr = cmdStr.substring(0, 300) + "...";
					log.info({
						module: "database.mongodb",
						action: "query.executing",
						message: `[${event.commandName}] ${cmdStr}`,
						context: { command: event.command }
					});
				});
				client.on("commandSucceeded", (event) => {
					if (ignoredCommands.includes(event.commandName)) return;
					log.success({
						module: "database.mongodb",
						action: "query.executed",
						message: `[${event.duration.toFixed(2)}ms] [${event.commandName}]`
					});
				});
				client.on("commandFailed", (event) => {
					if (ignoredCommands.includes(event.commandName)) return;
					log.error({
						module: "database.mongodb",
						action: "query.error",
						message: `[${event.duration.toFixed(2)}ms] [${event.commandName}]`,
						context: { failure: event.failure }
					});
				});
			}
			this.emit("connected");
		} catch (error) {
			await client.close().catch(() => void 0);
			this.emit("disconnected");
			log.error("database.mongodb", "connection", `Failed to connect to database: ${error.message}`);
			throw error;
		}
	}
	/**
	* Close the underlying MongoDB connection.
	*/
	async disconnect() {
		if (!this.client) return;
		try {
			await this.client.close();
		} finally {
			this.connected = false;
			this.emit("disconnected");
		}
	}
	/**
	* Subscribe to driver lifecycle events.
	*/
	on(event, listener) {
		this.events.on(event, listener);
	}
	/**
	* Insert a single document into the given collection.
	*/
	async insert(table, document, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		const result = await collection.insertOne(document, mongoOptions);
		return { document: {
			...document,
			_id: result.insertedId
		} };
	}
	/**
	* Insert multiple documents into the given collection.
	*/
	async insertMany(table, documents, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		const result = await collection.insertMany(documents, mongoOptions);
		return documents.map((document, index) => {
			const insertedId = result.insertedIds[index];
			return { document: {
				...document,
				_id: insertedId
			} };
		});
	}
	/**
	* Update a single document that matches the provided filter.
	*/
	async update(table, filter, update, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return { modifiedCount: (await collection.updateOne(filter, update, mongoOptions)).modifiedCount };
	}
	/**
	* Replace a single document that matches the provided filter.
	*/
	async replace(table, filter, document, options) {
		return (await this.getDatabaseInstance().collection(table).findOneAndReplace(filter, document))?.value;
	}
	/**
	* Find one and update a single document that matches the provided filter and return the updated document
	*/
	async findOneAndUpdate(table, filter, update, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return await collection.findOneAndUpdate(filter, update, {
			returnDocument: "after",
			...mongoOptions
		});
	}
	/**
	* Upsert (insert or update) a single document.
	*
	* Uses MongoDB's findOneAndUpdate with upsert option.
	*
	* @param table - Target collection name
	* @param filter - Filter conditions to find existing document
	* @param document - Document data to insert or update
	* @param options - Optional upsert options
	* @returns The upserted document
	*/
	async upsert(table, filter, document, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		const update = { $set: document };
		return await collection.findOneAndUpdate(filter, update, {
			upsert: true,
			returnDocument: "after",
			...mongoOptions
		});
	}
	/**
	* Find one and delete a single document that matches the provided filter and return the deleted document.
	*
	* @param table - Target collection name
	* @param filter - Filter conditions
	* @param options - Optional delete options
	* @returns The deleted document or null if not found
	*/
	async findOneAndDelete(table, filter, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return await collection.findOneAndDelete(filter, mongoOptions || {});
	}
	/**
	* Update multiple documents that match the provided filter.
	*/
	async updateMany(table, filter, update, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return { modifiedCount: (await collection.updateMany(filter, update, mongoOptions)).modifiedCount };
	}
	/**
	* Delete a single document that matches the provided filter.
	*/
	async delete(table, filter = {}, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return (await collection.deleteOne(filter, mongoOptions)).deletedCount > 0 ? 1 : 0;
	}
	/**
	* Delete documents that match the provided filter.
	*/
	async deleteMany(table, filter = {}, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return (await collection.deleteMany(filter, mongoOptions)).deletedCount ?? 0;
	}
	/**
	* Remove all records from a collection.
	*
	* This uses deleteMany with an empty filter to remove all documents.
	* For very large collections, consider using the migration driver's
	* dropTable + createTable approach for better performance.
	*/
	async truncateTable(table, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return (await collection.deleteMany({}, mongoOptions)).deletedCount ?? 0;
	}
	/**
	* Serialize the given data
	*/
	serialize(data) {
		const serialized = {};
		for (const [key, value] of Object.entries(data)) {
			if (value === void 0) continue;
			if (value instanceof ObjectId) serialized[key] = value.toString();
			else if (value instanceof Date) serialized[key] = value.toISOString();
			else if (typeof value === "bigint") serialized[key] = value.toString();
			else if (typeof value === "object" && value !== null && !Array.isArray(value)) serialized[key] = value;
			else serialized[key] = value;
		}
		return serialized;
	}
	/**
	* Get the dirty tracker for this driver.
	*/
	getDirtyTracker(data) {
		return new DatabaseDirtyTracker(data);
	}
	/**
	* Deserialize the given data
	*/
	deserialize(data) {
		if (data._id && typeof data._id === "string") data._id = new ObjectId(data._id);
		for (const [key, value] of Object.entries(data)) if (typeof value === "string" && isValidDateValue(value)) data[key] = new Date(value);
		return data;
	}
	/**
	* Provide a Mongo-backed query builder instance for the given collection.
	*/
	queryBuilder(table) {
		return new MongoQueryBuilder(table, dataSourceRegistry.get());
	}
	/**
	* Begin a MongoDB transaction, returning commit/rollback helpers.
	*/
	async beginTransaction() {
		const session = this.getClientInstance().startSession();
		await session.startTransaction(this.transactionOptions);
		databaseTransactionContext.enter({ session });
		let finished = false;
		const finalize = async (operation) => {
			if (finished) return;
			try {
				await operation();
			} finally {
				finished = true;
				databaseTransactionContext.exit();
				await session.endSession().catch(() => void 0);
			}
		};
		return {
			context: session,
			commit: async () => {
				await finalize(async () => {
					try {
						await session.commitTransaction();
					} catch (error) {
						await session.abortTransaction().catch(() => void 0);
						throw error;
					}
				});
			},
			rollback: async () => {
				await finalize(async () => {
					await session.abortTransaction();
				});
			}
		};
	}
	/**
	* Execute a function within a transaction scope (recommended pattern).
	*
	* Automatically commits on success, rolls back on any error, and guarantees
	* resource cleanup. This is the recommended way to use transactions.
	*
	* **MongoDB Requirements:**
	* - Requires MongoDB 4.0+ with replica set or sharded cluster
	* - Standalone MongoDB instances do not support transactions
	*
	* @param fn - Async function to execute within transaction
	* @param options - Transaction options (read preference, write concern, etc.)
	* @returns The return value of the callback function
	* @throws {Error} If transaction fails, is explicitly rolled back, or replica set not configured
	*/
	async transaction(fn, options) {
		if (databaseTransactionContext.hasActiveTransaction()) throw new Error("Nested transaction() calls are not supported. Use beginTransaction() with savepoints for advanced transaction patterns.");
		await this.ensureReplicaSetAvailable();
		const session = this.getClientInstance().startSession();
		try {
			await session.startTransaction({
				...this.transactionOptions,
				...options
			});
			databaseTransactionContext.enter({ session });
			try {
				const result = await fn({ rollback(reason) {
					throw new TransactionRollbackError(reason);
				} });
				await session.commitTransaction();
				return result;
			} catch (error) {
				await session.abortTransaction().catch(() => void 0);
				throw error;
			} finally {
				databaseTransactionContext.exit();
			}
		} finally {
			await session.endSession().catch(() => void 0);
		}
	}
	/**
	* Execute atomic operations (typically $inc/$set style updates) against documents.
	*
	* Uses `updateMany` so callers can atomically modify any set of documents.
	*/
	async atomic(table, filter, operations, options) {
		const collection = this.getDatabaseInstance().collection(table);
		const mongoOptions = this.withSession(options);
		return { modifiedCount: (await collection.updateMany(filter, operations, mongoOptions)).modifiedCount };
	}
	/**
	* Lazily create (and cache) the Mongo sync adapter.
	* The adapter uses this driver instance to ensure all operations
	* participate in active transactions via the session context.
	*/
	syncAdapter() {
		if (!this.syncAdapterInstance) this.syncAdapterInstance = new MongoSyncAdapter(this);
		return this.syncAdapterInstance;
	}
	/**
	* Lazily create (and cache) the Mongo migration driver.
	* The migration driver handles schema operations like indexes, collections, etc.
	*/
	migrationDriver() {
		if (!this.migrationDriverInstance) this.migrationDriverInstance = new MongoMigrationDriver(this);
		return this.migrationDriverInstance;
	}
	/**
	* Expose the underlying Mongo client for advanced consumers.
	*/
	getClient() {
		return this.getClientInstance();
	}
	/**
	* Retrieve the active Mongo client, throwing if the driver is disconnected.
	*/
	getClientInstance() {
		if (!this.client) throw new Error("Mongo driver is not connected.");
		return this.client;
	}
	/**
	* Retrieve the active Mongo database, throwing if the driver is disconnected.
	* @private
	*/
	getDatabaseInstance() {
		if (!this.database) throw new Error("Mongo driver is not connected to a database.");
		return this.database;
	}
	/**
	* Resolve the Mongo connection string based on provided options.
	*/
	resolveUri() {
		if (this.config.uri) return this.config.uri;
		return `mongodb://${this.config.host ?? "localhost"}:${this.config.port ?? 27017}`;
	}
	/**
	* Build the Mongo client options derived from the driver configuration.
	*/
	buildClientOptions() {
		const baseOptions = { ...this.config.clientOptions ?? {} };
		if (this.config.logging) baseOptions.monitorCommands = true;
		if (this.config.username && !baseOptions.auth) baseOptions.auth = {
			username: this.config.username,
			password: this.config.password
		};
		if (this.config.authSource && !baseOptions.authSource) baseOptions.authSource = this.config.authSource;
		return baseOptions;
	}
	/**
	* Emit a driver lifecycle event.
	*/
	emit(event, ...args) {
		this.events.emit(event, ...args);
	}
	/**
	* Ensure MongoDB is running as a replica set (required for transactions).
	*
	* @throws {Error} If MongoDB is running as a standalone instance
	*/
	async ensureReplicaSetAvailable() {
		try {
			if (!(await this.database.admin().serverStatus()).repl) throw new Error("MongoDB transactions require a replica set or sharded cluster. Standalone MongoDB instances do not support transactions.\n\nFor local development:\n  - Run MongoDB with --replSet flag: mongod --replSet rs0\n  - Or use Docker with replica set configuration\n  - Or use MongoDB Atlas (cloud) which provides replica sets by default");
		} catch (error) {
			if (error.message?.includes("replica set")) throw error;
			throw new Error(`Failed to check MongoDB replica set status: ${error.message}`);
		}
	}
	/**
	* Attach the active transaction session (when available) to Mongo options.
	*/
	withSession(options) {
		const session = databaseTransactionContext.getSession();
		if (!session) return options;
		const baseOptions = options ? { ...options } : {};
		baseOptions.session = session;
		return baseOptions;
	}
	/**
	* Return a SQL serializer for this driver's dialect.
	* Not supported for MongoDB.
	*/
	getSQLSerializer() {
		throw new Error("MongoDB driver does not support SQL serialization.");
	}
	/**
	* Execute a raw SQL query.
	* Not supported for MongoDB.
	*/
	async query(_sql, _params) {
		throw new Error("MongoDB driver does not support raw SQL queries.");
	}
	/**
	* Create a new database.
	*
	* In MongoDB, databases are created automatically when data is first written.
	* This method creates an empty collection to ensure the database exists.
	*
	* @param name - Database name to create
	* @returns true if created, false if already exists
	*/
	async createDatabase(name) {
		const client = this.getClientInstance();
		if (await this.databaseExists(name)) return false;
		try {
			const db = client.db(name);
			await db.createCollection("__init__");
			await db.collection("__init__").drop();
			log.success("database", "lifecycle", `Created database ${name}`);
			return true;
		} catch (error) {
			log.error("database", "lifecycle", `Failed to create database ${name}: ${error}`);
			throw error;
		}
	}
	/**
	* Drop a database.
	*
	* @param name - Database name to drop
	* @returns true if dropped, false if didn't exist
	*/
	async dropDatabase(name) {
		const client = this.getClientInstance();
		if (!await this.databaseExists(name)) return false;
		try {
			await client.db(name).dropDatabase();
			log.success("database", "lifecycle", `Dropped database ${name}`);
			return true;
		} catch (error) {
			log.error("database", "lifecycle", `Failed to drop database ${name}: ${error}`);
			throw error;
		}
	}
	/**
	* Check if a database exists.
	*
	* @param name - Database name to check
	* @returns true if database exists
	*/
	async databaseExists(name) {
		return (await this.getClientInstance().db("admin").admin().listDatabases()).databases.some((db) => db.name === name);
	}
	/**
	* List all databases.
	*
	* @returns Array of database names
	*/
	async listDatabases() {
		return (await this.getClientInstance().db("admin").admin().listDatabases()).databases.map((db) => db.name).filter((name) => ![
			"admin",
			"local",
			"config"
		].includes(name));
	}
	/**
	* Drop a collection.
	*
	* @param name - Collection name to drop
	* @throws Error if collection doesn't exist
	*/
	async dropTable(name) {
		await this.getDatabaseInstance().collection(name).drop();
		log.success("database", "collection", `Dropped collection ${name}`);
	}
	/**
	* Drop a collection if it exists.
	*
	* @param name - Collection name to drop
	*/
	async dropTableIfExists(name) {
		if (await this.blueprint.tableExists(name)) await this.dropTable(name);
	}
	/**
	* Drop all collections in the current database.
	*
	* Useful for `migrate:fresh` command.
	*/
	async dropAllTables() {
		const collections = await this.blueprint.listTables();
		if (collections.length === 0) return;
		const db = this.getDatabaseInstance();
		for (const collection of collections) await db.collection(collection).drop();
		log.success("database", "collection", `Dropped ${collections.length} collections`);
	}
};
//#endregion
export { MongoDbDriver, isMongoDBDriverLoaded };

//# sourceMappingURL=mongodb-driver.mjs.map