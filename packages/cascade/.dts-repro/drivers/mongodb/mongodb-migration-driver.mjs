import { databaseTransactionContext } from "../../context/database-transaction-context.mjs";
//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-migration-driver.ts
/**
* MongoDB-specific migration driver implementation.
*
* Key behaviors:
* - Column operations are **no-ops** (MongoDB is schema-less)
* - Index operations use native `createIndex()`
* - Foreign keys are **no-ops** (MongoDB has no FK constraints)
* - TTL indexes supported natively
* - Vector indexes use Atlas Search (when available)
* - Schema validation uses `collMod` command
*
* @example
* ```typescript
* const migrationDriver = new MongoMigrationDriver(mongoDriver);
* await migrationDriver.createIndex("users", {
*   columns: ["email"],
*   unique: true,
* });
* ```
*/
var MongoMigrationDriver = class {
	driver;
	/** Active transaction session (if any) */
	session;
	/**
	* Create a new MongoDB migration driver.
	*
	* @param driver - The MongoDB driver instance
	*/
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Get the MongoDB database instance.
	*/
	get db() {
		return this.driver.getDatabase();
	}
	/**
	* Get session options for operations.
	*/
	get sessionOptions() {
		const session = databaseTransactionContext.getSession();
		return session ? { session } : void 0;
	}
	/**
	* Create a new collection.
	*
	* MongoDB creates collections lazily on first insert, but this method
	* creates them explicitly for migrations that need to add indexes or
	* schema validation.
	*/
	async createTable(table) {
		try {
			await this.db.createCollection(table);
		} catch (error) {
			if (error.codeName === "NamespaceExists") return;
			throw error;
		}
	}
	/**
	* Create table if not exists
	*/
	async createTableIfNotExists(table) {
		try {
			await this.db.createCollection(table);
		} catch (error) {
			if (error.codeName === "NamespaceExists") return;
			throw error;
		}
	}
	/**
	* Drop an existing collection.
	*
	* @throws Error if collection doesn't exist
	*/
	async dropTable(table) {
		await this.db.dropCollection(table);
	}
	/**
	* Drop collection if it exists (no error if missing).
	*/
	async dropTableIfExists(table) {
		try {
			await this.db.dropCollection(table);
		} catch {}
	}
	/**
	* Rename a collection.
	*/
	async renameTable(from, to) {
		await this.db.renameCollection(from, to);
	}
	/**
	* Truncate a collection — remove all documents.
	*
	* @param table - Collection name
	*/
	async truncateTable(table) {
		await this.db.collection(table).deleteMany({});
	}
	/**
	* Check if a collection exists.
	*/
	async tableExists(table) {
		return (await this.db.listCollections({ name: table }).toArray()).length > 0;
	}
	/**
	* List all columns in a collection.
	*
	* MongoDB is schema-less, so this returns an empty array.
	* For actual schema inspection, would need to sample documents.
	*/
	async listColumns(_table) {
		return [];
	}
	/**
	* List all collections in the current database.
	*/
	async listTables() {
		return (await this.db.listCollections().toArray()).map((col) => col.name);
	}
	/**
	* Ensure the migrations tracking collection exists.
	*
	* MongoDB creates collections lazily, but we can create explicitly
	* and add a unique index on the name field.
	*
	* @param tableName - Name of the migrations collection
	*/
	async ensureMigrationsTable(tableName) {
		if (!await this.tableExists(tableName)) await this.db.createCollection(tableName);
		await this.db.collection(tableName).createIndex({ name: 1 }, { unique: true });
	}
	/**
	* Add a column (no-op for MongoDB).
	*
	* MongoDB is schema-less, so columns don't need to be declared.
	*/
	async addColumn(_table, _column) {}
	/**
	* Drop a column by running $unset on all documents.
	*
	* This actually removes the field from all documents in the collection.
	*/
	async dropColumn(table, column) {
		await this.db.collection(table).updateMany({}, { $unset: { [column]: "" } }, this.sessionOptions);
	}
	/**
	* Drop multiple columns by running $unset on all documents.
	*/
	async dropColumns(table, columns) {
		const collection = this.db.collection(table);
		const unsetFields = {};
		for (const column of columns) unsetFields[column] = "";
		await collection.updateMany({}, { $unset: unsetFields }, this.sessionOptions);
	}
	/**
	* Rename a column by running $rename on all documents.
	*/
	async renameColumn(table, from, to) {
		await this.db.collection(table).updateMany({}, { $rename: { [from]: to } }, this.sessionOptions);
	}
	/**
	* Modify a column definition (no-op for MongoDB).
	*
	* MongoDB is schema-less, so column types don't need to be modified.
	*/
	async modifyColumn(_table, _column) {}
	/**
	* Create standard timestamp columns (created_at, updated_at).
	*
	* MongoDB implementation is a no-op since timestamps are handled
	* at the application level via Model hooks.
	*
	* @param _table - Collection name (unused)
	*/
	async createTimestampColumns(_table) {}
	/**
	* Create an index on one or more columns.
	*
	* **Note**: Expression-based indexes, INCLUDE clause, and concurrent creation
	* are PostgreSQL-specific features and are silently ignored by MongoDB.
	*/
	async createIndex(table, index) {
		if (index.expressions && index.expressions.length > 0) return;
		const collection = this.db.collection(table);
		const indexSpec = {};
		for (let i = 0; i < index.columns.length; i++) {
			const column = index.columns[i];
			indexSpec[column] = index.directions?.[i] === "desc" ? -1 : 1;
		}
		const options = {};
		if (index.name) options.name = index.name;
		if (index.unique) options.unique = true;
		if (index.sparse) options.sparse = true;
		if (index.where) options.partialFilterExpression = index.where;
		await collection.createIndex(indexSpec, options);
	}
	/**
	* Drop an index by name or columns.
	*
	* @param indexNameOrColumns - Index name (string) or columns array
	*/
	async dropIndex(table, indexNameOrColumns) {
		const collection = this.db.collection(table);
		if (!Array.isArray(indexNameOrColumns)) indexNameOrColumns = [indexNameOrColumns];
		const indexName = indexNameOrColumns.map((col) => `${col}_1`).join("_");
		await collection.dropIndex(indexName);
	}
	/**
	* Create a unique index/constraint.
	*/
	async createUniqueIndex(table, columns, name) {
		await this.createIndex(table, {
			columns,
			unique: true,
			name
		});
	}
	/**
	* Drop a unique index by finding its name from columns.
	*/
	async dropUniqueIndex(table, columns) {
		const collection = this.db.collection(table);
		const indexes = await collection.indexes();
		for (const idx of indexes) {
			const indexKeys = Object.keys(idx.key || {});
			if (indexKeys.length === columns.length && indexKeys.every((key, i) => key === columns[i])) {
				if (idx.name && idx.name !== "_id_") {
					await collection.dropIndex(idx.name);
					return;
				}
			}
		}
	}
	/**
	* Create a full-text search index.
	*
	* MongoDB uses "text" index type for full-text search.
	*/
	async createFullTextIndex(table, columns, options) {
		const collection = this.db.collection(table);
		const indexSpec = {};
		for (const column of columns) indexSpec[column] = "text";
		const indexOptions = {};
		if (options?.name) indexOptions.name = options.name;
		if (options?.language) indexOptions.default_language = options.language;
		if (options?.weights) indexOptions.weights = options.weights;
		await collection.createIndex(indexSpec, indexOptions);
	}
	/**
	* Drop a full-text search index.
	*/
	async dropFullTextIndex(table, name) {
		await this.dropIndex(table, name);
	}
	/**
	* Create a geo-spatial index.
	*/
	async createGeoIndex(table, column, options) {
		const collection = this.db.collection(table);
		const indexType = options?.type ?? "2dsphere";
		const indexOptions = {};
		if (options?.name) indexOptions.name = options.name;
		if (options?.min !== void 0) indexOptions.min = options.min;
		if (options?.max !== void 0) indexOptions.max = options.max;
		await collection.createIndex({ [column]: indexType }, indexOptions);
	}
	/**
	* Drop a geo-spatial index.
	*/
	async dropGeoIndex(table, column) {
		const collection = this.db.collection(table);
		const indexes = await collection.indexes();
		for (const idx of indexes) {
			const key = idx.key || {};
			if (column in key && (key[column] === "2dsphere" || key[column] === "2d")) {
				if (idx.name && idx.name !== "_id_") {
					await collection.dropIndex(idx.name);
					return;
				}
			}
		}
	}
	/**
	* Create a vector search index for AI embeddings.
	*
	* Note: This requires MongoDB Atlas with Vector Search enabled.
	* For self-hosted MongoDB, this will create a regular index on the field.
	*/
	async createVectorIndex(table, column, options) {
		const collection = this.db.collection(table);
		try {
			const searchIndexes = await collection.listSearchIndexes?.()?.toArray?.();
			if (Array.isArray(searchIndexes)) {
				await collection.createSearchIndex({
					name: options.name ?? `${column}_vector_idx`,
					definition: { mappings: {
						dynamic: false,
						fields: { [column]: {
							type: "knnVector",
							dimensions: options.dimensions,
							similarity: options.similarity ?? "cosine"
						} }
					} }
				});
				return;
			}
		} catch {}
		await collection.createIndex({ [column]: 1 }, { name: options.name ?? `${column}_vector_idx` });
	}
	/**
	* Drop a vector search index.
	*/
	async dropVectorIndex(table, column) {
		const collection = this.db.collection(table);
		try {
			const searchIndexes = await collection.listSearchIndexes?.()?.toArray?.();
			if (Array.isArray(searchIndexes)) {
				for (const idx of searchIndexes) if (idx.name?.includes(column)) {
					await collection.dropSearchIndex(idx.name);
					return;
				}
			}
		} catch {}
		const indexName = `${column}_vector_idx`;
		try {
			await collection.dropIndex(indexName);
		} catch {}
	}
	/**
	* Create a TTL (time-to-live) index for automatic document expiration.
	*/
	async createTTLIndex(table, column, expireAfterSeconds) {
		await this.db.collection(table).createIndex({ [column]: 1 }, { expireAfterSeconds });
	}
	/**
	* Drop a TTL index.
	*/
	async dropTTLIndex(table, column) {
		const collection = this.db.collection(table);
		const indexes = await collection.indexes();
		for (const idx of indexes) if (column in (idx.key || {}) && idx.expireAfterSeconds !== void 0) {
			if (idx.name && idx.name !== "_id_") {
				await collection.dropIndex(idx.name);
				return;
			}
		}
	}
	/**
	* List all indexes on a collection.
	*
	* @param table - Collection name
	* @returns Array of index metadata
	*/
	async listIndexes(table) {
		return (await this.db.collection(table).indexes()).map((idx) => ({
			name: idx.name ?? "",
			columns: Object.keys(idx.key ?? {}),
			type: "btree",
			unique: idx.unique ?? false,
			partial: !!idx.partialFilterExpression,
			options: {
				sparse: idx.sparse,
				expireAfterSeconds: idx.expireAfterSeconds
			}
		}));
	}
	/**
	* Add a foreign key constraint (no-op for MongoDB).
	*
	* MongoDB doesn't support foreign key constraints.
	* Use application-level validation or DBRefs instead.
	*/
	async addForeignKey(_table, _foreignKey) {}
	/**
	* Drop a foreign key constraint (no-op for MongoDB).
	*/
	async dropForeignKey(_table, _name) {}
	/**
	* Add a primary key constraint (no-op for MongoDB).
	*
	* MongoDB always has _id as the primary key.
	*/
	async addPrimaryKey(_table, _columns) {}
	/**
	* Drop the primary key constraint (no-op for MongoDB).
	*/
	async dropPrimaryKey(_table) {}
	/**
	* Add a CHECK constraint (no-op for MongoDB).
	*
	* MongoDB doesn't support CHECK constraints.
	* Use schema validation instead.
	*/
	async addCheck(_table, _name, _expression) {}
	/**
	* Drop a CHECK constraint (no-op for MongoDB).
	*/
	async dropCheck(_table, _name) {}
	/**
	* Set JSON schema validation rules on a collection.
	*
	* Uses MongoDB's validator feature to enforce document structure.
	*
	* @example
	* ```typescript
	* await driver.setSchemaValidation("users", {
	*   bsonType: "object",
	*   required: ["name", "email"],
	*   properties: {
	*     name: { bsonType: "string" },
	*     email: { bsonType: "string" },
	*   },
	* });
	* ```
	*/
	async setSchemaValidation(table, schema) {
		await this.db.command({
			collMod: table,
			validator: { $jsonSchema: schema },
			validationLevel: "strict",
			validationAction: "error"
		});
	}
	/**
	* Remove schema validation rules from a collection.
	*/
	async removeSchemaValidation(table) {
		await this.db.command({
			collMod: table,
			validator: {},
			validationLevel: "off"
		});
	}
	/**
	* Begin a database transaction.
	*
	* Uses the driver's transaction mechanism.
	*/
	async beginTransaction() {
		const transaction = await this.driver.beginTransaction();
		this.session = transaction.context;
	}
	/**
	* Commit the current transaction.
	*/
	async commit() {
		if (this.session) {
			await this.session.commitTransaction();
			await this.session.endSession();
			this.session = void 0;
		}
	}
	/**
	* Rollback the current transaction.
	*/
	async rollback() {
		if (this.session) {
			await this.session.abortTransaction();
			await this.session.endSession();
			this.session = void 0;
		}
	}
	/**
	* MongoDB supports transactions (requires replica set).
	*/
	supportsTransactions() {
		return true;
	}
	/**
	* Get the default transactional behavior for MongoDB.
	*
	* MongoDB DDL operations (createCollection, createIndex, etc.) cannot
	* be wrapped in transactions, even with replica sets. Transactions only
	* work for document CRUD operations.
	*
	* @returns false (MongoDB DDL is not transactional)
	*/
	getDefaultTransactional() {
		return false;
	}
	/**
	* Get the default UUID generation expression for MongoDB.
	*
	* MongoDB does not use SQL-level UUID defaults — UUID generation
	* is handled at the application level. Always returns `undefined`.
	*
	* @param _migrationDefaults - Ignored (MongoDB handles UUIDs at app level)
	* @returns undefined
	*/
	getUuidDefault(_migrationDefaults) {}
	/**
	* Check if a database extension is available (no-op for MongoDB).
	*
	* @param _extension - Extension name
	*/
	async isExtensionAvailable(_extension) {
		return true;
	}
	/**
	* Get the official documentation or installation URL for a database extension.
	*
	* @param _extension - Extension name
	*/
	getExtensionDocsUrl(_extension) {}
	/**
	* Execute raw operations with direct database access.
	*
	* @param callback - Callback receiving the MongoDB Db instance
	* @returns Result from callback
	*
	* @example
	* ```typescript
	* await driver.raw(async (db) => {
	*   await db.collection("users").updateMany({}, { $set: { active: true } });
	* });
	* ```
	*/
	async raw(callback) {
		return callback(this.db);
	}
};
//#endregion
export { MongoMigrationDriver };

//# sourceMappingURL=mongodb-migration-driver.mjs.map