import { databaseTransactionContext } from "../../context/database-transaction-context.mjs";
import { TransactionRollbackError } from "../../errors/transaction-rollback.error.mjs";
import { isValidDateValue } from "../../utils/is-valid-date-value.mjs";
import { PostgresBlueprint } from "./postgres-blueprint.mjs";
import { PostgresDialect } from "./postgres-dialect.mjs";
import { SqlDatabaseDirtyTracker } from "../../sql-database-dirty-tracker.mjs";
import { PostgresMigrationDriver } from "./postgres-migration-driver.mjs";
import { PostgresQueryBuilder } from "./postgres-query-builder.mjs";
import { PostgresSQLSerializer } from "./postgres-sql-serializer.mjs";
import { PostgresSyncAdapter } from "./postgres-sync-adapter.mjs";
import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-driver.ts
/**
* PostgreSQL Driver
*
* Main driver implementation for PostgreSQL database operations.
* Implements the DriverContract interface to provide a unified API
* for CRUD operations, transactions, and query building.
*
* Uses the `pg` package for database connectivity with connection pooling.
*
* @module cascade/drivers/postgres
*/
/**
* Cached pg module reference.
*/
let pgModule;
/**
* Lazily load the pg package.
*
* @returns The pg module
* @throws Error if pg is not installed
*/
async function loadPg() {
	if (pgModule) return pgModule;
	try {
		pgModule = await import("pg");
		return pgModule;
	} catch {
		throw new Error("The \"pg\" package is required for PostgreSQL support. Please install it: npm install pg");
	}
}
/**
* PostgreSQL database driver implementing the Cascade DriverContract.
*
* Provides connection pooling, CRUD operations, transactions, and
* integration with Cascade's query builder and migration systems.
*
* @example
* ```typescript
* const driver = new PostgresDriver({
*   host: 'localhost',
*   port: 5432,
*   database: 'myapp',
*   user: 'postgres',
*   password: 'secret'
* });
*
* await driver.connect();
*
* // Insert a document
* const result = await driver.insert('users', { name: 'Alice', email: 'alice@example.com' });
*
* // Query using the query builder
* const users = await driver.queryBuilder('users')
*   .where('name', 'Alice')
*   .get();
*
* await driver.disconnect();
* ```
*/
var PostgresDriver = class {
	config;
	/**
	* Driver name identifier.
	*/
	name = "postgres";
	/**
	* SQL dialect for PostgreSQL-specific syntax.
	*/
	dialect = new PostgresDialect();
	/**
	* PostgreSQL driver model defaults.
	*
	* PostgreSQL follows SQL conventions:
	* - snake_case naming for columns (created_at, updated_at, deleted_at)
	* - Native AUTO_INCREMENT for IDs (no manual generation)
	* - Timestamps enabled by default
	* - Permanent delete strategy (hard deletes)
	*/
	modelDefaults = {
		namingConvention: "snake_case",
		createdAtColumn: "created_at",
		updatedAtColumn: "updated_at",
		deletedAtColumn: "deleted_at",
		timestamps: true,
		autoGenerateId: false,
		strictMode: "fail",
		deleteStrategy: "permanent"
	};
	/**
	* Connection pool instance.
	*/
	_pool;
	/**
	* Event listeners for driver lifecycle events.
	*/
	_eventListeners = /* @__PURE__ */ new Map();
	/**
	* Whether the driver is currently connected.
	*/
	_isConnected = false;
	/**
	* Blueprint instance (lazy-loaded).
	*/
	_blueprint;
	/**
	* Migration driver instance (lazy-loaded).
	*/
	_migrationDriver;
	/**
	* Sync adapter instance (lazy-loaded).
	*/
	_syncAdapter;
	/**
	* Create a new PostgreSQL driver instance.
	*
	* @param config - PostgreSQL connection configuration
	*/
	constructor(config) {
		this.config = config;
	}
	/**
	* Get the connection pool instance.
	*
	* @throws Error if not connected
	*/
	get pool() {
		if (!this._pool) throw new Error("PostgreSQL driver is not connected. Call connect() first.");
		return this._pool;
	}
	/**
	* Get database native client
	*/
	getClient() {
		return this.pool;
	}
	/**
	* Check if the driver is currently connected.
	*/
	get isConnected() {
		return this._isConnected;
	}
	/**
	* Get the driver blueprint (information schema).
	*/
	get blueprint() {
		if (!this._blueprint) this._blueprint = new PostgresBlueprint(this);
		return this._blueprint;
	}
	/**
	* Establish connection to the PostgreSQL database.
	*
	* Creates a connection pool with the configured options.
	* Emits 'connected' event on successful connection.
	*/
	async connect() {
		if (this._isConnected) return;
		const pg = await loadPg();
		try {
			const poolConfig = {
				host: this.config.host ?? "localhost",
				port: this.config.port ?? 5432,
				database: this.config.database,
				user: this.config.user,
				password: this.config.password,
				connectionString: this.config.connectionString,
				max: this.config.max ?? 10,
				min: this.config.min ?? 0,
				idleTimeoutMillis: this.config.idleTimeoutMillis ?? 3e4,
				connectionTimeoutMillis: this.config.connectionTimeoutMillis ?? 2e3,
				application_name: this.config.application_name ?? "cascade",
				ssl: this.config.ssl
			};
			log.info("database.postgres", "connection", `Connecting to database ${colors.bold(colors.yellowBright(this.config.database))}`);
			this._pool = new pg.Pool(poolConfig);
			(await this._pool.connect()).release();
			log.success("database.postgres", "connection", `Connected to database ${colors.bold(colors.yellowBright(this.config.database))}`);
			this._isConnected = true;
			this.emit("connected");
		} catch (error) {
			log.error("database.postgres", "connection", "Failed to connect to database");
			throw error;
		}
	}
	/**
	* Close the database connection pool.
	*
	* Waits for all active queries to complete before closing.
	* Emits 'disconnected' event on successful disconnection.
	*/
	async disconnect() {
		if (!this._isConnected || !this._pool) return;
		await this._pool.end();
		this._pool = void 0;
		this._isConnected = false;
		this.emit("disconnected");
	}
	/**
	* Register an event listener for driver lifecycle events.
	*
	* @param event - Event name ('connected', 'disconnected', etc.)
	* @param listener - Callback function to invoke
	*/
	on(event, listener) {
		if (!this._eventListeners.has(event)) this._eventListeners.set(event, /* @__PURE__ */ new Set());
		this._eventListeners.get(event).add(listener);
	}
	/**
	* Serialize data for storage in PostgreSQL.
	*
	* Handles Date objects, BigInt, and other JavaScript types
	* that need special handling for PostgreSQL storage.
	*
	* @param data - The data object to serialize
	* @returns Serialized data ready for PostgreSQL
	*/
	serialize(data) {
		const serialized = {};
		for (const [key, value] of Object.entries(data)) {
			if (value === void 0) continue;
			if (value instanceof Date) serialized[key] = value.toISOString();
			else if (typeof value === "bigint") serialized[key] = value.toString();
			else if (typeof value === "object" && value !== null && !Array.isArray(value)) serialized[key] = value;
			else if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number")) serialized[key] = `[${value.join(",")}]`;
			else serialized[key] = value;
		}
		return serialized;
	}
	/**
	* Get the dirty tracker for this driver.
	*/
	getDirtyTracker(data) {
		return new SqlDatabaseDirtyTracker(data);
	}
	/**
	* Deserialize data retrieved from PostgreSQL.
	*
	* Converts PostgreSQL types back to JavaScript equivalents.
	*
	* @param data - The data object from PostgreSQL
	* @returns Deserialized JavaScript object
	*/
	deserialize(data) {
		for (const [key, value] of Object.entries(data)) {
			if (typeof value !== "string") continue;
			if (isValidDateValue(value)) {
				data[key] = new Date(value);
				continue;
			}
			if (value.charCodeAt(0) === 91 && value.charCodeAt(value.length - 1) === 93) {
				const parts = value.slice(1, -1).split(",");
				const nums = new Array(parts.length);
				let isNumericVector = parts.length > 0;
				for (let i = 0; i < parts.length; i++) {
					const n = +parts[i];
					if (!Number.isFinite(n)) {
						isNumericVector = false;
						break;
					}
					nums[i] = n;
				}
				if (isNumericVector) data[key] = nums;
			}
		}
		return data;
	}
	/**
	* Insert a single row into a table.
	*
	* Uses INSERT ... RETURNING to get the inserted row with generated values.
	*
	* @param table - Target table name
	* @param document - Data to insert
	* @param options - Optional insertion options
	* @returns The inserted document
	*/
	async insert(table, document, _options) {
		const serialized = this.serialize(document);
		const filteredData = Object.fromEntries(Object.entries(serialized).filter(([key, value]) => {
			if (key === "id" && (value === null || value === void 0)) return false;
			return true;
		}));
		const columns = Object.keys(filteredData);
		const values = Object.values(filteredData);
		if (columns.length === 0) throw new Error("Cannot insert empty document");
		const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
		const placeholders = columns.map((_, i) => this.dialect.placeholder(i + 1)).join(", ");
		const sql = `INSERT INTO ${this.dialect.quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`;
		return { document: (await this.query(sql, values)).rows[0] };
	}
	/**
	* Insert multiple rows into a table.
	*
	* Uses a single INSERT statement with multiple value sets for efficiency.
	*
	* @param table - Target table name
	* @param documents - Array of documents to insert
	* @param options - Optional insertion options
	* @returns Array of inserted documents
	*/
	async insertMany(table, documents, _options) {
		if (documents.length === 0) return [];
		const allColumns = /* @__PURE__ */ new Set();
		for (const doc of documents) {
			const serialized = this.serialize(doc);
			Object.keys(serialized).forEach((key) => allColumns.add(key));
		}
		const columns = Array.from(allColumns);
		const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
		const quotedTable = this.dialect.quoteIdentifier(table);
		const valueSets = [];
		const params = [];
		let paramIndex = 1;
		for (const doc of documents) {
			const serialized = this.serialize(doc);
			const rowPlaceholders = [];
			for (const col of columns) if (col in serialized) {
				rowPlaceholders.push(this.dialect.placeholder(paramIndex++));
				params.push(serialized[col]);
			} else rowPlaceholders.push("DEFAULT");
			valueSets.push(`(${rowPlaceholders.join(", ")})`);
		}
		const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${valueSets.join(", ")} RETURNING *`;
		return (await this.query(sql, params)).rows;
	}
	/**
	* Update a single row matching the filter.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param update - Update operations ($set, $unset, $inc)
	* @param options - Optional update options
	* @returns Update result with modified count
	*/
	async update(table, filter, update, _options) {
		const { sql, params } = this.buildUpdateQuery(table, filter, update, 1);
		try {
			return { modifiedCount: (await this.query(sql, params)).rowCount ?? 0 };
		} catch (error) {
			console.log("PG Query Error in:", sql, params);
			throw error;
		}
	}
	/**
	* Find one and update a single row matching the filter and return the updated row
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param update - Update operations ($set, $unset, $inc)
	* @param options - Optional update options
	* @returns The updated row or null
	*/
	async findOneAndUpdate(table, filter, update, _options) {
		const { sql, params } = this.buildUpdateQuery(table, filter, update, 1);
		const sqlWithReturning = `${sql} RETURNING *`;
		return (await this.query(sqlWithReturning, params)).rows[0] ?? null;
	}
	/**
	* Update multiple rows matching the filter.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param update - Update operations
	* @param options - Optional update options
	* @returns Update result with modified count
	*/
	async updateMany(table, filter, update, _options) {
		const { sql, params } = this.buildUpdateQuery(table, filter, update);
		return { modifiedCount: (await this.query(sql, params)).rowCount ?? 0 };
	}
	/**
	* Replace a document matching the filter.
	*
	* Completely replaces the document (not a partial update).
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param document - New document data
	* @param options - Optional options
	* @returns The replaced document or null
	*/
	async replace(table, filter, document, _options) {
		const serialized = this.serialize(document);
		const columns = Object.keys(serialized);
		const values = Object.values(serialized);
		const quotedTable = this.dialect.quoteIdentifier(table);
		const setClauses = columns.map((col, i) => `${this.dialect.quoteIdentifier(col)} = ${this.dialect.placeholder(i + 1)}`).join(", ");
		const { whereClause, whereParams } = this.buildWhereClause(filter, columns.length + 1);
		const sql = `UPDATE ${quotedTable} SET ${setClauses} ${whereClause} RETURNING *`;
		const params = [...values, ...whereParams];
		return (await this.query(sql, params)).rows[0] ?? null;
	}
	/**
	* Upsert (insert or update) a single row.
	*
	* Uses PostgreSQL's INSERT ... ON CONFLICT ... DO UPDATE syntax.
	*
	* @param table - Target table name
	* @param filter - Filter conditions to find existing row (used for conflict detection)
	* @param document - Document data to insert or update
	* @param options - Upsert options (conflictColumns for conflict target)
	* @returns The upserted row
	*/
	async upsert(table, filter, document, options) {
		const serialized = this.serialize(document);
		const columns = Object.keys(serialized);
		const values = Object.values(serialized);
		if (columns.length === 0) throw new Error("Cannot upsert empty document");
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
		const placeholders = columns.map((_, i) => this.dialect.placeholder(i + 1)).join(", ");
		const conflictColumns = options?.conflictColumns ?? Object.keys(filter);
		if (conflictColumns.length === 0) throw new Error("Upsert requires conflictColumns option or filter with columns");
		const quotedConflictColumns = conflictColumns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
		const setClauses = columns.filter((col) => !conflictColumns.includes(col)).map((col, i) => {
			const valueIndex = columns.indexOf(col) + 1;
			return `${this.dialect.quoteIdentifier(col)} = ${this.dialect.placeholder(valueIndex)}`;
		}).join(", ");
		const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT (${quotedConflictColumns}) DO UPDATE SET ${setClauses.length > 0 ? setClauses : columns.map((col) => `${this.dialect.quoteIdentifier(col)} = EXCLUDED.${this.dialect.quoteIdentifier(col)}`).join(", ")} RETURNING *`;
		return (await this.query(sql, values)).rows[0];
	}
	/**
	* Find one and delete a single row matching the filter and return the deleted row.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param options - Optional delete options
	* @returns The deleted row or null
	*/
	async findOneAndDelete(table, filter, _options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const { whereClause, whereParams } = this.buildWhereClause(filter, 1);
		const sql = `DELETE FROM ${quotedTable} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1) RETURNING *`;
		const result = await this.query(sql, whereParams);
		return result.rows[0] ? result.rows[0] : null;
	}
	/**
	* Delete a single row matching the filter.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param options - Optional options
	* @returns Number of deleted rows (0 or 1)
	*/
	async delete(table, filter, _options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const { whereClause, whereParams } = this.buildWhereClause(filter ?? {}, 1);
		const sql = `DELETE FROM ${quotedTable} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1)`;
		return (await this.query(sql, whereParams)).rowCount ?? 0;
	}
	/**
	* Delete multiple rows matching the filter.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param options - Optional options
	* @returns Number of deleted rows
	*/
	async deleteMany(table, filter, _options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const { whereClause, whereParams } = this.buildWhereClause(filter ?? {}, 1);
		const sql = `DELETE FROM ${quotedTable} ${whereClause}`;
		return (await this.query(sql, whereParams)).rowCount ?? 0;
	}
	/**
	* Truncate a table (remove all rows).
	*
	* Uses TRUNCATE TABLE for fast deletion with RESTART IDENTITY.
	*
	* @param table - Target table name
	* @param options - Optional options
	* @param options.cascade - If true, automatically truncate all tables with foreign key references (use with caution)
	* @returns Number of deleted rows (always 0 for TRUNCATE)
	*/
	async truncateTable(table, options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const cascadeClause = options?.cascade ? " CASCADE" : "";
		await this.query(`TRUNCATE TABLE ${quotedTable} RESTART IDENTITY${cascadeClause}`);
		return 0;
	}
	/**
	* Get a query builder for the specified table.
	*
	* @param table - Target table name
	* @returns Query builder instance
	*/
	queryBuilder(table) {
		return new PostgresQueryBuilder(table);
	}
	/**
	* Begin a new database transaction.
	*
	* Acquires a client from the pool and starts a transaction.
	* The client is stored in AsyncLocalStorage for automatic
	* participation by subsequent queries.
	*
	* @param options - Optional transaction options
	* @returns Transaction contract with commit/rollback methods
	*/
	async beginTransaction(options) {
		const client = await this.pool.connect();
		let beginSql = "BEGIN";
		if (options?.isolationLevel) beginSql += ` ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`;
		if (options?.readOnly) beginSql += " READ ONLY";
		if (options?.deferrable) beginSql += " DEFERRABLE";
		await client.query(beginSql);
		return {
			context: client,
			commit: async () => {
				await client.query("COMMIT");
				client.release();
			},
			rollback: async () => {
				await client.query("ROLLBACK");
				client.release();
			}
		};
	}
	/**
	* Execute a function within a transaction scope (recommended pattern).
	*
	* Automatically commits on success, rolls back on any error, and guarantees
	* resource cleanup. This is the recommended way to use transactions.
	*
	* @param fn - Async function to execute within transaction
	* @param options - Transaction options (isolation level, read-only, etc.)
	* @returns The return value of the callback function
	* @throws {Error} If transaction fails or is explicitly rolled back
	*/
	async transaction(fn, options) {
		if (databaseTransactionContext.hasActiveTransaction()) {}
		const tx = await this.beginTransaction(options);
		databaseTransactionContext.enter({ session: tx.context });
		try {
			const result = await fn({ rollback(reason) {
				throw new TransactionRollbackError(reason);
			} });
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback();
			log.error(`database.postgress`, "transaction", "Transaction operation failed, rolled back everything");
			throw error;
		} finally {
			databaseTransactionContext.exit();
		}
	}
	/**
	* Perform an atomic update operation.
	*
	* Builds and executes an UPDATE query for the given filter and operations.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param operations - Update operations
	* @param options - Optional options
	* @returns Update result
	*/
	async atomic(table, filter, operations, _options) {
		const { sql, params } = this.buildUpdateQuery(table, filter, operations, 1);
		return { modifiedCount: (await this.query(sql, params)).rowCount ?? 0 };
	}
	/**
	* Get the sync adapter for bulk denormalized updates.
	*
	* @returns Sync adapter instance
	*/
	syncAdapter() {
		if (!this._syncAdapter) this._syncAdapter = new PostgresSyncAdapter(this);
		return this._syncAdapter;
	}
	/**
	* Get the migration driver for schema operations.
	*
	* @returns Migration driver instance
	*/
	migrationDriver() {
		if (!this._migrationDriver) this._migrationDriver = new PostgresMigrationDriver(this);
		return this._migrationDriver;
	}
	/**
	* Return a SQL serializer for this driver's dialect.
	* Used by Migration.toSQL() to convert pending operations to SQL strings.
	*/
	getSQLSerializer() {
		return new PostgresSQLSerializer(this.dialect);
	}
	/**
	* Execute a raw SQL query.
	*
	* Automatically uses the transaction client if one is active.
	*
	* @param sql - SQL query string
	* @param params - Query parameters
	* @returns Query result
	*/
	async query(sql, params = []) {
		const txClient = databaseTransactionContext.getSession();
		const startTime = this.config.logging ? performance.now() : 0;
		let paramsString = "";
		if (this.config.logging && params.length > 0) {
			paramsString = JSON.stringify(params);
			if (paramsString.length > 300) paramsString = paramsString.substring(0, 300) + "...";
			paramsString = ` | Params: ${paramsString}`;
		}
		try {
			let result;
			if (this.config.logging) log.info({
				module: "database.postgres",
				action: "query.executing",
				message: `${sql}${paramsString}`,
				context: {
					params,
					sql
				}
			});
			if (txClient) result = await txClient.query(sql, params);
			else result = await this.pool.query(sql, params);
			if (this.config.logging) {
				const duration = (performance.now() - startTime).toFixed(2);
				log.success({
					module: "database.postgres",
					action: "query.executed",
					message: `[${duration}ms] ${sql}${paramsString}`,
					context: {
						params,
						sql,
						duration
					}
				});
			}
			return result;
		} catch (error) {
			if (this.config.logging) {
				const duration = (performance.now() - startTime).toFixed(2);
				log.error({
					module: "database.postgres",
					action: "query.error",
					message: `[${duration}ms] ${sql}${paramsString}`,
					context: {
						sql,
						params,
						error: error instanceof Error ? error.message : String(error)
					}
				});
			}
			throw error;
		}
	}
	/**
	* Emit an event to all registered listeners.
	*
	* @param event - Event name
	* @param args - Event arguments
	*/
	emit(event, ...args) {
		const listeners = this._eventListeners.get(event);
		if (listeners) for (const listener of listeners) listener(...args);
	}
	/**
	* Build a simple WHERE clause from a filter object.
	*
	* @param filter - Filter conditions
	* @param startParamIndex - Starting parameter index
	* @returns Object with WHERE clause string and parameters
	*/
	buildWhereClause(filter, startParamIndex) {
		const conditions = [];
		const params = [];
		let paramIndex = startParamIndex;
		for (const [key, value] of Object.entries(filter)) {
			const quotedKey = this.dialect.quoteIdentifier(key);
			if (value === null) conditions.push(`${quotedKey} IS NULL`);
			else {
				conditions.push(`${quotedKey} = ${this.dialect.placeholder(paramIndex++)}`);
				params.push(value);
			}
		}
		return {
			whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
			whereParams: params
		};
	}
	/**
	* Build an UPDATE query from update operations.
	*
	* @param table - Target table name
	* @param filter - Filter conditions
	* @param update - Update operations
	* @param limit - Optional limit (for single row update)
	* @returns Object with SQL and parameters
	*/
	buildUpdateQuery(table, filter, update, limit) {
		const setClauses = [];
		const params = [];
		let paramIndex = 1;
		if (update.$set) for (const [key, value] of Object.entries(update.$set)) {
			setClauses.push(`${this.dialect.quoteIdentifier(key)} = ${this.dialect.placeholder(paramIndex++)}`);
			params.push(value);
		}
		if (update.$unset) for (const key of Object.keys(update.$unset)) setClauses.push(`${this.dialect.quoteIdentifier(key)} = NULL`);
		if (update.$inc) for (const [key, amount] of Object.entries(update.$inc)) {
			const quotedKey = this.dialect.quoteIdentifier(key);
			setClauses.push(`${quotedKey} = COALESCE(${quotedKey}, 0) + ${this.dialect.placeholder(paramIndex++)}`);
			params.push(amount);
		}
		if (update.$dec) for (const [key, amount] of Object.entries(update.$dec)) {
			const quotedKey = this.dialect.quoteIdentifier(key);
			setClauses.push(`${quotedKey} = COALESCE(${quotedKey}, 0) - ${this.dialect.placeholder(paramIndex++)}`);
			params.push(amount);
		}
		if (setClauses.length === 0) throw new Error("No update operations specified");
		const quotedTable = this.dialect.quoteIdentifier(table);
		const { whereClause, whereParams } = this.buildWhereClause(filter, paramIndex);
		params.push(...whereParams);
		let sql = `UPDATE ${quotedTable} SET ${setClauses.join(", ")} ${whereClause}`;
		if (limit === 1 && whereClause) sql = `UPDATE ${quotedTable} SET ${setClauses.join(", ")} WHERE ctid IN (SELECT ctid FROM ${quotedTable} ${whereClause} LIMIT 1)`;
		return {
			sql,
			params
		};
	}
	/**
	* Create a new database.
	*
	* Note: This requires connecting to a system database (like 'postgres')
	* since you cannot create a database while connected to it.
	*
	* @param name - Database name to create
	* @param options - Creation options (encoding, template, etc.)
	* @returns true if created, false if already exists
	*/
	async createDatabase(name, options) {
		if (await this.databaseExists(name)) return false;
		let sql = `CREATE DATABASE ${this.dialect.quoteIdentifier(name)}`;
		const withClauses = [];
		if (options?.encoding) withClauses.push(`ENCODING = '${options.encoding}'`);
		if (options?.template) withClauses.push(`TEMPLATE = ${this.dialect.quoteIdentifier(options.template)}`);
		if (options?.locale) {
			withClauses.push(`LC_COLLATE = '${options.locale}'`);
			withClauses.push(`LC_CTYPE = '${options.locale}'`);
		}
		if (options?.owner) withClauses.push(`OWNER = ${this.dialect.quoteIdentifier(options.owner)}`);
		if (withClauses.length > 0) sql += ` WITH ${withClauses.join(" ")}`;
		try {
			await this.query(sql);
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
	* @param options - Drop options
	* @returns true if dropped, false if didn't exist
	*/
	async dropDatabase(name, options) {
		if (!options?.ifExists && !await this.databaseExists(name)) return false;
		const quotedName = this.dialect.quoteIdentifier(name);
		let sql = "DROP DATABASE";
		if (options?.ifExists) sql += " IF EXISTS";
		sql += ` ${quotedName}`;
		if (options?.force) sql += " WITH (FORCE)";
		try {
			await this.query(sql);
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
		return (await this.query(`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) as exists`, [name])).rows[0]?.exists ?? false;
	}
	/**
	* List all databases.
	*
	* @returns Array of database names
	*/
	async listDatabases() {
		return (await this.query(`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`)).rows.map((row) => row.datname);
	}
	/**
	* Drop a table.
	*
	* @param name - Table name to drop
	* @throws Error if table doesn't exist
	*/
	async dropTable(name) {
		const quotedName = this.dialect.quoteIdentifier(name);
		await this.query(`DROP TABLE ${quotedName}`);
		log.success("database", "table", `Dropped table ${name}`);
	}
	/**
	* Drop a table if it exists.
	*
	* @param name - Table name to drop
	*/
	async dropTableIfExists(name) {
		const quotedName = this.dialect.quoteIdentifier(name);
		await this.query(`DROP TABLE IF EXISTS ${quotedName}`);
	}
	/**
	* Drop all tables in the current database.
	*
	* Uses CASCADE to handle foreign key dependencies.
	* Useful for `migrate:fresh` command.
	*/
	async dropAllTables() {
		const tables = await this.blueprint.listTables();
		if (tables.length === 0) return;
		for (const table of tables) {
			const quotedName = this.dialect.quoteIdentifier(table);
			await this.query(`DROP TABLE IF EXISTS ${quotedName} CASCADE`);
		}
		log.success("database", "table", `Dropped ${tables.length} tables`);
	}
};
//#endregion
export { PostgresDriver };

//# sourceMappingURL=postgres-driver.mjs.map