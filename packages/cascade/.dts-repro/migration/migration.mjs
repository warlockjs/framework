import { ColumnBuilder } from "./column-builder.mjs";
import { ForeignKeyBuilder } from "./foreign-key-builder.mjs";
//#region ../../@warlock.js/cascade/src/migration/migration.ts
/**
* Base class for all database migrations.
*
* Provides a fluent API for defining schema changes that work across
* both SQL and NoSQL databases. The migration driver handles translating
* operations to native database commands.
*
* Migrations are executed in order based on their `createdAt` timestamp,
* which is typically extracted from the filename (e.g., `2024-01-15_create-users`).
*
* @example
* ```typescript
* // Using Migration.for() to bind to a model
* export default class extends Migration.for(User) {
*   public up(): void {
*     this.string("email").unique();
*     this.integer("age").nullable();
*     this.geoIndex("location");
*   }
*
*   public down(): void {
*     this.dropColumn("email");
*     this.dropColumn("age");
*     this.dropGeoIndex("location");
*   }
* }
* ```
*
* @example
* ```typescript
* // Manual table migration (without model binding)
* export default class CreateUsersTable extends Migration {
*   public readonly table = "users";
*
*   public up(): void {
*     this.createTable();
*     this.id();
*     this.string("name");
*     this.string("email").unique();
*     this.timestamps();
*   }
*
*   public down(): void {
*     this.dropTable();
*   }
* }
* ```
*/
var Migration = class {
	/**
	* Migration name that will be labeled with
	* If record is enabled in migration, it will be stored as migration name
	* in database
	*
	* @example
	* ```typescript
	* "2024-01-15_create-users";
	* ```
	*/
	static migrationName;
	/**
	* Table/collection name for this migration.
	*
	* Must be defined by each migration class (either directly or via `Migration.for()`).
	*/
	table;
	/**
	* Sort order
	* If not provided, it will be ordered alphabetically
	*/
	static order;
	/**
	* Optional data source override.
	*
	* If specified, this migration will use a specific data source
	* instead of the default one. Can be a string name or DataSource instance.
	*/
	dataSource;
	/**
	* Optional timestamp override.
	*
	* By default, the migration runner extracts this from the filename.
	* Set explicitly to override the execution order.
	*
	* Format: ISO 8601 or any parseable date string.
	*/
	static createdAt;
	/**
	* Whether to wrap migration in a transaction.
	*
	* Defaults to `true` for SQL databases that support DDL transactions.
	* Set to `false` for operations that cannot be transactional.
	*
	* Note: MongoDB does not support transactions for most DDL operations.
	*/
	transactional;
	/**
	* Migration driver instance (injected by the runner).
	*/
	driver;
	/**
	* Migration defaults from the resolved DataSource.
	* @internal
	*/
	/** @internal — readable by factory-generated subclasses */
	_migrationDefaults;
	/**
	* Queued operations to execute.
	*/
	pendingOperations = [];
	/**
	* Create a migration class bound to a specific model.
	*
	* Automatically inherits the model's table name and data source,
	* reducing boilerplate and ensuring consistency.
	*
	* @param model - Model class to bind
	* @returns Abstract migration class bound to the model
	*
	* @example
	* ```typescript
	* export default class extends Migration.for(User) {
	*   public up(): void {
	*     this.string("avatar").nullable();
	*   }
	*
	*   public down(): void {
	*     this.dropColumn("avatar");
	*   }
	* }
	* ```
	*/
	static for(model) {
		class BoundMigration extends Migration {
			table = model.table;
			dataSource = model.dataSource;
		}
		return BoundMigration;
	}
	/**
	* Create a migration that executes raw SQL statements.
	*
	* Intended for external packages that ship engine-specific DDL — typically a
	* one-shot `CREATE TABLE` bundle whose `up` is the only direction that matters.
	* The `down` direction is optional; when omitted, rollback is a recorded no-op.
	*
	* Raw SQL is engine-locked by definition. This factory is rejected on MongoDB
	* data sources at execute time — use the fluent builder for cross-engine work.
	*
	* @param options - Migration name, SQL statements, and optional overrides
	* @returns Migration constructor ready to register with the runner
	*
	* @example
	* ```typescript
	* export const createAuthTables = Migration.rawSql({
	*   name: "create_auth_tables",
	*   up: [
	*     `CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL)`,
	*     `CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id))`,
	*   ],
	* });
	* ```
	*/
	static rawSql(options) {
		const { name, up, down, dataSource, transactional } = options;
		const toStatements = (input) => Array.isArray(input) ? input : [input];
		class RawSqlMigration extends Migration {
			table = "";
			dataSource = dataSource;
			transactional = transactional;
			up() {
				this.guardEngine();
				for (const sql of toStatements(up)) this.raw(sql);
			}
			down() {
				if (down === void 0) return;
				this.guardEngine();
				for (const sql of toStatements(down)) this.raw(sql);
			}
			guardEngine() {
				if (this.databaseEngine === "mongodb") throw new Error(`Migration.rawSql ("${name}") is not supported on mongodb data sources — use the fluent builder instead.`);
			}
		}
		RawSqlMigration.migrationName = name;
		return RawSqlMigration;
	}
	/**
	* Set the migration driver.
	*
	* Called by the migration runner before executing up/down.
	*
	* @param driver - Migration driver instance
	* @internal
	*/
	setDriver(driver) {
		this.driver = driver;
	}
	/**
	* Set migration defaults from the resolved DataSource.
	*
	* @param defaults - Migration defaults (UUID strategy, etc.)
	* @internal
	*/
	setMigrationDefaults(defaults) {
		this._migrationDefaults = defaults;
	}
	/**
	* Get the migration driver.
	*
	* @returns The migration driver instance
	*/
	getDriver() {
		return this.driver;
	}
	/**
	* Get database engine (MongoDB, Postgress...etc)
	*/
	get databaseEngine() {
		return this.driver.driver.name;
	}
	/**
	* Execute all pending operations.
	*
	* @deprecated Use toSQL() instead — migrations now generate SQL rather than
	* executing DDL directly through the driver.
	* @internal
	*/
	async execute() {
		for (const op of this.pendingOperations) await this.executeOperation(op);
		this.pendingOperations.length = 0;
	}
	/**
	* Serialize all queued pending operations into a flat list of SQL strings.
	*
	* Call this AFTER invoking `up()` or `down()` to extract the SQL for the
	* operations that were queued during that call. The pending queue is cleared
	* after serializing so the instance is safe to reuse.
	*
	* @example
	* ```typescript
	* const migration = new CreateUsersTable();
	* migration.setDriver(driver);
	*
	* // Up SQL
	* await migration.up();
	* const upSQL = migration.toSQL();
	*
	* // Down SQL — reuse the same instance
	* await migration.down();
	* const downSQL = migration.toSQL();
	* ```
	*/
	toSQL() {
		const statements = this.driver.driver.getSQLSerializer().serializeAll(this.pendingOperations, this.table);
		this.pendingOperations.length = 0;
		return statements;
	}
	/**
	* Execute a single pending operation.
	*/
	async executeOperation(op) {
		switch (op.type) {
			case "addColumn": {
				const column = op.payload;
				await this.driver.addColumn(this.table, column);
				if (column.checkConstraint) await this.driver.addCheck(this.table, column.checkConstraint.name, column.checkConstraint.expression);
				break;
			}
			case "dropColumn":
				await this.driver.dropColumn(this.table, op.payload);
				break;
			case "dropColumns":
				await this.driver.dropColumns(this.table, op.payload);
				break;
			case "renameColumn": {
				const { from, to } = op.payload;
				await this.driver.renameColumn(this.table, from, to);
				break;
			}
			case "modifyColumn":
				await this.driver.modifyColumn(this.table, op.payload);
				break;
			case "createIndex":
				await this.driver.createIndex(this.table, op.payload);
				break;
			case "dropIndex":
				await this.driver.dropIndex(this.table, op.payload);
				break;
			case "createUniqueIndex": {
				const { columns, name } = op.payload;
				await this.driver.createUniqueIndex(this.table, columns, name);
				break;
			}
			case "dropUniqueIndex":
				await this.driver.dropUniqueIndex(this.table, op.payload);
				break;
			case "createFullTextIndex": {
				const { columns, options } = op.payload;
				await this.driver.createFullTextIndex(this.table, columns, options);
				break;
			}
			case "dropFullTextIndex":
				await this.driver.dropFullTextIndex(this.table, op.payload);
				break;
			case "createGeoIndex": {
				const { column, options } = op.payload;
				await this.driver.createGeoIndex(this.table, column, options);
				break;
			}
			case "dropGeoIndex":
				await this.driver.dropGeoIndex(this.table, op.payload);
				break;
			case "createVectorIndex": {
				const { column, options } = op.payload;
				await this.driver.createVectorIndex(this.table, column, options);
				break;
			}
			case "dropVectorIndex":
				await this.driver.dropVectorIndex(this.table, op.payload);
				break;
			case "createTTLIndex": {
				const { column, seconds } = op.payload;
				await this.driver.createTTLIndex(this.table, column, seconds);
				break;
			}
			case "dropTTLIndex":
				await this.driver.dropTTLIndex(this.table, op.payload);
				break;
			case "addForeignKey":
				await this.driver.addForeignKey(this.table, op.payload);
				break;
			case "dropForeignKey":
				await this.driver.dropForeignKey(this.table, op.payload);
				break;
			case "addPrimaryKey":
				await this.driver.addPrimaryKey(this.table, op.payload);
				break;
			case "dropPrimaryKey":
				await this.driver.dropPrimaryKey(this.table);
				break;
			case "addCheck": {
				const { name, expression } = op.payload;
				await this.driver.addCheck(this.table, name, expression);
				break;
			}
			case "dropCheck":
				await this.driver.dropCheck(this.table, op.payload);
				break;
			case "createTable":
				await this.driver.createTable(this.table);
				break;
			case "createTableIfNotExists":
				await this.driver.createTableIfNotExists(this.table);
				break;
			case "dropTable":
				await this.driver.dropTable(this.table);
				break;
			case "dropTableIfExists":
				await this.driver.dropTableIfExists(this.table);
				break;
			case "renameTable":
				await this.driver.renameTable(this.table, op.payload);
				break;
			case "truncateTable":
				await this.driver.truncateTable(this.table);
				break;
			case "createTimestamps":
				await this.driver.createTimestampColumns(this.table);
				break;
			case "rawStatement":
				await this.driver.raw(async (client) => {
					const sql = op.payload;
					if (typeof client.query === "function") await client.query(sql);
					else if (typeof client.command === "function") await client.command({ $eval: sql });
					else throw new Error("Unsupported database driver for statement execution");
				});
				break;
			case "setSchemaValidation":
				await this.driver.setSchemaValidation(this.table, op.payload);
				break;
			case "removeSchemaValidation":
				await this.driver.removeSchemaValidation(this.table);
				break;
		}
	}
	/**
	* Check if a table exists.
	*
	* Useful for conditional migrations and idempotent operations.
	*
	* @param tableName - Table name to check
	* @returns Promise resolving to true if table exists
	*
	* @example
	* ```typescript
	* public async up() {
	*   if (await this.hasTable("users_backup")) {
	*     this.dropTable("users_backup");
	*   }
	*   // ... rest of migration
	* }
	* ```
	*/
	async hasTable(tableName) {
		return this.driver.tableExists(tableName);
	}
	/**
	* Check if a column exists in the current table.
	*
	* @param columnName - Column name to check
	* @returns Promise resolving to true if column exists
	*
	* @example
	* ```typescript
	* public async up() {
	*   if (!(await this.hasColumn("email"))) {
	*     this.string("email").unique();
	*   }
	* }
	* ```
	*/
	async hasColumn(columnName) {
		return (await this.getColumns()).some((col) => col.name === columnName);
	}
	/**
	* Get all columns in the current table.
	*
	* @returns Promise resolving to array of column definitions
	*
	* @example
	* ```typescript
	* const columns = await this.getColumns();
	* if (columns.find(col => col.type === "string" && !col.length)) {
	*   // migrate all unbounded strings
	* }
	* ```
	*/
	async getColumns() {
		return this.driver.listColumns(this.table);
	}
	/**
	* List all tables in the current database/connection.
	*
	* @returns Promise resolving to array of table names
	*
	* @example
	* ```typescript
	* const tables = await this.listTables();
	* for (const table of tables) {
	*   // process each table
	* }
	* ```
	*/
	async listTables() {
		return this.driver.listTables();
	}
	/**
	* Get all indexes on the current table.
	*/
	async getIndexes() {
		return this.driver.listIndexes(this.table);
	}
	/**
	* Check if a named index exists on the current table.
	*/
	async hasIndex(indexName) {
		return (await this.getIndexes()).some((idx) => idx.name === indexName);
	}
	/**
	* Add a pending index definition.
	*
	* Called by ColumnBuilder when .unique() or .index() is chained.
	* Routes into pendingOperations so indexes execute in definition order
	* alongside columns and constraints.
	*
	* @param index - Index definition
	* @internal
	*/
	addPendingIndex(index) {
		if (index.unique) this.pendingOperations.push({
			type: "createUniqueIndex",
			payload: {
				columns: index.columns,
				name: index.name
			}
		});
		else this.pendingOperations.push({
			type: "createIndex",
			payload: index
		});
	}
	/**
	* Add a foreign key operation.
	*
	* Called by ForeignKeyBuilder or ColumnBuilder when .references() is called.
	*
	* @param fk - Foreign key definition
	* @internal
	*/
	addForeignKeyOperation(fk) {
		this.pendingOperations.push({
			type: "addForeignKey",
			payload: fk
		});
	}
	/**
	* Create the table/collection.
	*
	* For SQL, this creates an empty table.
	* For MongoDB, this creates the collection.
	*
	* @returns This migration for chaining
	*/
	createTable() {
		this.pendingOperations.push({
			type: "createTable",
			payload: null
		});
		return this;
	}
	/**
	* Create table if not exists
	*/
	createTableIfNotExists() {
		this.pendingOperations.push({
			type: "createTableIfNotExists",
			payload: null
		});
		return this;
	}
	/**
	* Drop the table/collection.
	*
	* @returns This migration for chaining
	*/
	dropTable() {
		this.pendingOperations.push({
			type: "dropTable",
			payload: null
		});
		return this;
	}
	/**
	* Drop the table/collection if it exists.
	*
	* No error is thrown if the table doesn't exist.
	*
	* @returns This migration for chaining
	*/
	dropTableIfExists() {
		this.pendingOperations.push({
			type: "dropTableIfExists",
			payload: null
		});
		return this;
	}
	/**
	* Rename the table/collection.
	*
	* @param newName - New table name
	* @returns This migration for chaining
	*/
	renameTableTo(newName) {
		this.pendingOperations.push({
			type: "renameTable",
			payload: newName
		});
		return this;
	}
	/**
	* Truncate the table — remove all rows without logging or firing triggers.
	*
	* Faster than DELETE with no WHERE clause. Resets auto-increment counters
	* on most databases.
	*
	* @returns This migration for chaining
	*/
	truncateTable() {
		this.pendingOperations.push({
			type: "truncateTable",
			payload: null
		});
		return this;
	}
	/**
	* Add a string/varchar column.
	*
	* @param column - Column name
	* @param length - Max length (default: 255)
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.string("name"); // VARCHAR(255)
	* this.string("code", 10); // VARCHAR(10)
	* ```
	*/
	string(column, length = 255) {
		const builder = new ColumnBuilder(this, column, "string", { length });
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a fixed-length char column.
	*
	* @param column - Column name
	* @param length - Exact length
	* @returns Column builder for chaining modifiers
	*/
	char(column, length) {
		const builder = new ColumnBuilder(this, column, "char", { length });
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a text column (unlimited length).
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	text(column) {
		const builder = new ColumnBuilder(this, column, "text");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a medium text column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	mediumText(column) {
		const builder = new ColumnBuilder(this, column, "mediumText");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a long text column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	longText(column) {
		const builder = new ColumnBuilder(this, column, "longText");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add an integer column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	integer(column) {
		const builder = new ColumnBuilder(this, column, "integer");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for integer().
	*/
	int(column) {
		return this.integer(column);
	}
	/**
	* Add a small integer column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	smallInteger(column) {
		const builder = new ColumnBuilder(this, column, "smallInteger");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for smallInteger().
	*/
	smallInt(column) {
		return this.smallInteger(column);
	}
	/**
	* Add a tiny integer column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	tinyInteger(column) {
		const builder = new ColumnBuilder(this, column, "tinyInteger");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for tinyInteger().
	*/
	tinyInt(column) {
		return this.tinyInteger(column);
	}
	/**
	* Add a big integer column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	bigInteger(column) {
		const builder = new ColumnBuilder(this, column, "bigInteger");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for bigInteger().
	*/
	bigInt(column) {
		return this.bigInteger(column);
	}
	/**
	* Add a float column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	float(column) {
		const builder = new ColumnBuilder(this, column, "float");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a double precision column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	double(column) {
		const builder = new ColumnBuilder(this, column, "double");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a decimal column with precision and scale.
	*
	* @param column - Column name
	* @param precision - Total digits (default: 8)
	* @param scale - Decimal places (default: 2)
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.decimal("price", 10, 2); // DECIMAL(10,2) - up to 99999999.99
	* ```
	*/
	decimal(column, precision = 8, scale = 2) {
		const builder = new ColumnBuilder(this, column, "decimal", {
			precision,
			scale
		});
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a boolean column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	boolean(column) {
		const builder = new ColumnBuilder(this, column, "boolean");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for boolean().
	*/
	bool(column) {
		return this.boolean(column);
	}
	/**
	* Add a date column (date only, no time).
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	date(column) {
		const builder = new ColumnBuilder(this, column, "date");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a datetime column (date and time).
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	dateTime(column) {
		const builder = new ColumnBuilder(this, column, "dateTime");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a timestamp column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	timestamp(column) {
		const builder = new ColumnBuilder(this, column, "timestamp");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a time column (time only, no date).
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	time(column) {
		const builder = new ColumnBuilder(this, column, "time");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a year column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	year(column) {
		const builder = new ColumnBuilder(this, column, "year");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a JSON column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	json(column) {
		const builder = new ColumnBuilder(this, column, "json");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for json().
	*/
	object(column) {
		return this.json(column);
	}
	/**
	* Add a binary/blob column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	binary(column) {
		const builder = new ColumnBuilder(this, column, "binary");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Alias for binary().
	*/
	blob(column) {
		return this.binary(column);
	}
	/**
	* Add a UUID column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	uuid(column) {
		const builder = new ColumnBuilder(this, column, "uuid");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a ULID column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	ulid(column) {
		const builder = new ColumnBuilder(this, column, "ulid");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add an IP address column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	ipAddress(column) {
		const builder = new ColumnBuilder(this, column, "ipAddress");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a MAC address column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	macAddress(column) {
		const builder = new ColumnBuilder(this, column, "macAddress");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a geo point column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	point(column) {
		const builder = new ColumnBuilder(this, column, "point");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a polygon column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	polygon(column) {
		const builder = new ColumnBuilder(this, column, "polygon");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a line string column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	lineString(column) {
		const builder = new ColumnBuilder(this, column, "lineString");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a generic geometry column.
	*
	* @param column - Column name
	* @returns Column builder for chaining modifiers
	*/
	geometry(column) {
		const builder = new ColumnBuilder(this, column, "geometry");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a vector column for AI embeddings.
	*
	* Used for storing and searching ML embeddings (e.g., OpenAI, Cohere).
	*
	* @param column - Column name
	* @param dimensions - Vector dimensions (e.g., 1536 for OpenAI ada-002)
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.vector("embedding", 1536); // OpenAI ada-002
	* this.vector("embedding", 384);  // Sentence Transformers
	* ```
	*/
	vector(column, dimensions) {
		const builder = new ColumnBuilder(this, column, "vector", { dimensions });
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add an enum column with allowed values.
	*
	* @param column - Column name
	* @param values - Allowed enum values
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.enum("status", ["pending", "active", "archived"]);
	* ```
	*/
	enum(column, values) {
		const builder = new ColumnBuilder(this, column, "enum", { values });
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a set column (multiple values from a set).
	*
	* @param column - Column name
	* @param values - Allowed set values
	* @returns Column builder for chaining modifiers
	*/
	set(column, values) {
		const builder = new ColumnBuilder(this, column, "set", { values });
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add an INTEGER[] column (array of integers).
	*
	* @example
	* ```typescript
	* this.arrayInt("scores"); // INTEGER[]
	* ```
	*/
	arrayInt(column) {
		const builder = new ColumnBuilder(this, column, "arrayInt");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a BIGINT[] column (array of big integers).
	*
	* @example
	* ```typescript
	* this.arrayBigInt("ids"); // BIGINT[]
	* ```
	*/
	arrayBigInt(column) {
		const builder = new ColumnBuilder(this, column, "arrayBigInt");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a REAL[] column (array of floats).
	*
	* @example
	* ```typescript
	* this.arrayFloat("weights"); // REAL[]
	* ```
	*/
	arrayFloat(column) {
		const builder = new ColumnBuilder(this, column, "arrayFloat");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a DECIMAL[] column (array of decimals).
	*
	* @param precision - Total digits
	* @param scale - Digits after decimal point
	*
	* @example
	* ```typescript
	* this.arrayDecimal("prices", 10, 2); // DECIMAL(10,2)[]
	* this.arrayDecimal("amounts");        // DECIMAL[]
	* ```
	*/
	arrayDecimal(column, precision, scale) {
		const builder = new ColumnBuilder(this, column, "arrayDecimal", {
			precision,
			scale
		});
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a BOOLEAN[] column (array of booleans).
	*
	* @example
	* ```typescript
	* this.arrayBoolean("flags"); // BOOLEAN[]
	* ```
	*/
	arrayBoolean(column) {
		const builder = new ColumnBuilder(this, column, "arrayBoolean");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a TEXT[] column (array of text values).
	*
	* @example
	* ```typescript
	* this.arrayText("tags"); // TEXT[]
	* ```
	*/
	arrayText(column) {
		const builder = new ColumnBuilder(this, column, "arrayText");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a DATE[] column (array of dates).
	*
	* @example
	* ```typescript
	* this.arrayDate("holidays"); // DATE[]
	* ```
	*/
	arrayDate(column) {
		const builder = new ColumnBuilder(this, column, "arrayDate");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a TIMESTAMPTZ[] column (array of timestamps with time zone).
	*
	* @example
	* ```typescript
	* this.arrayTimestamp("events"); // TIMESTAMPTZ[]
	* ```
	*/
	arrayTimestamp(column) {
		const builder = new ColumnBuilder(this, column, "arrayTimestamp");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a UUID[] column (array of UUIDs).
	*
	* @example
	* ```typescript
	* this.arrayUuid("relatedIds"); // UUID[]
	* ```
	*/
	arrayUuid(column) {
		const builder = new ColumnBuilder(this, column, "arrayUuid");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add a JSONB[] column — array of JSON objects.
	*
	* @example
	* ```typescript
	* this.arrayJson("metadata"); // JSONB[]
	* ```
	*/
	arrayJson(column) {
		const builder = new ColumnBuilder(this, column, "arrayJson");
		this.pendingOperations.push({
			type: "addColumn",
			payload: builder.getDefinition()
		});
		return builder;
	}
	/**
	* Add an auto-increment primary key column.
	*
	* Creates an unsigned integer with primary key and auto-increment.
	*
	* @param name - Column name (default: "id")
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.id(); // Creates "id" column
	* this.id("userId"); // Creates "userId" column
	* ```
	*/
	id(name = "id") {
		return this.integer(name).primary().autoIncrement().unsigned();
	}
	/**
	* Add a big integer auto-increment primary key column.
	*
	* @param name - Column name (default: "id")
	* @returns Column builder for chaining modifiers
	*/
	bigId(name = "id") {
		return this.bigInteger(name).primary().autoIncrement().unsigned();
	}
	/**
	* Add a UUID primary key column.
	*
	* @param name - Column name (default: "id")
	* @returns Column builder for chaining modifiers
	*/
	uuidId(name = "id") {
		return this.uuid(name).primary();
	}
	/**
	* Add a UUID primary key column with automatic generation.
	*
	* Delegates UUID expression to the migration driver, which resolves
	* the default based on `migrationDefaults` from the DataSource config.
	*
	* Resolution order:
	* 1. `migrationDefaults.uuidExpression` (raw escape hatch)
	* 2. `migrationDefaults.uuidStrategy` (mapped per driver)
	* 3. Driver default (PostgreSQL: `gen_random_uuid()`, MongoDB: undefined)
	*
	* @param name - Column name (default: "id")
	* @returns Column builder for chaining modifiers
	*
	* @example
	* ```typescript
	* this.primaryUuid(); // id UUID PRIMARY KEY DEFAULT gen_random_uuid()
	* this.primaryUuid("organization_id"); // Custom column name
	* ```
	*/
	primaryUuid(name = "id") {
		const uuidDefault = this.driver.getUuidDefault(this._migrationDefaults);
		const builder = this.uuid(name).primary();
		if (uuidDefault) builder.default(uuidDefault);
		return builder;
	}
	/**
	* Add createdAt and updatedAt timestamp columns.
	*
	* Behavior varies by database driver:
	* - PostgreSQL: Creates TIMESTAMPTZ columns with NOW() defaults
	* - MongoDB: No-op (timestamps handled at application level)
	*
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.timestamps(); // Driver-specific implementation
	* ```
	*/
	timestamps() {
		this.pendingOperations.push({
			type: "createTimestamps",
			payload: null
		});
		return this;
	}
	/**
	* Add a deletedAt column for soft deletes.
	*
	* @param column - Column name (default: "deletedAt")
	* @returns Column builder for chaining modifiers
	*/
	softDeletes(column = "deletedAt") {
		return this.dateTime(column).nullable();
	}
	/**
	* Drop a column.
	*
	* @param column - Column name to drop
	* @returns This migration for chaining
	*/
	dropColumn(column) {
		this.pendingOperations.push({
			type: "dropColumn",
			payload: column
		});
		return this;
	}
	/**
	* Drop multiple columns.
	*
	* @param columns - Column names to drop
	* @returns This migration for chaining
	*/
	dropColumns(...columns) {
		this.pendingOperations.push({
			type: "dropColumns",
			payload: columns
		});
		return this;
	}
	/**
	* Rename a column.
	*
	* @param from - Current column name
	* @param to - New column name
	* @returns This migration for chaining
	*/
	renameColumn(from, to) {
		this.pendingOperations.push({
			type: "renameColumn",
			payload: {
				from,
				to
			}
		});
		return this;
	}
	/**
	* Create an index on one or more columns.
	*
	* @param columns - Column(s) to index
	* @param name - Optional index name
	* @param options - Optional index options (include, concurrently)
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.index("email");
	* this.index(["firstName", "lastName"], "name_idx");
	* this.index("userId", "idx_user", { include: ["name", "email"] });
	* this.index("email", "idx_email", { concurrently: true });
	* ```
	*/
	index(columns, name, options) {
		const cols = Array.isArray(columns) ? columns : [columns];
		this.pendingOperations.push({
			type: "createIndex",
			payload: {
				columns: cols,
				name,
				include: options?.include,
				concurrently: options?.concurrently
			}
		});
		return this;
	}
	/**
	* Drop an index by name or columns.
	*
	* @param nameOrColumns - Index name (string) or columns array
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.dropIndex("email_idx"); // Drop by name
	* this.dropIndex(["firstName", "lastName"]); // Drop by columns
	* ```
	*/
	dropIndex(nameOrColumns) {
		this.pendingOperations.push({
			type: "dropIndex",
			payload: nameOrColumns
		});
		return this;
	}
	/**
	* Create a unique constraint/index.
	*
	* @param columns - Column(s) to make unique
	* @param name - Optional constraint name
	* @param options - Optional index options (include, concurrently)
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.unique("email");
	* this.unique(["userId", "roleId"], "unique_user_role");
	* this.unique("email", "unique_email", { include: ["name"] });
	* ```
	*/
	unique(columns, name, options) {
		const cols = Array.isArray(columns) ? columns : [columns];
		this.pendingOperations.push({
			type: "createUniqueIndex",
			payload: {
				columns: cols,
				name,
				include: options?.include,
				concurrently: options?.concurrently
			}
		});
		return this;
	}
	/**
	* Drop a unique constraint/index.
	*
	* @param columns - Columns in the unique constraint
	* @returns This migration for chaining
	*/
	dropUnique(columns) {
		const cols = Array.isArray(columns) ? columns : [columns];
		this.pendingOperations.push({
			type: "dropUniqueIndex",
			payload: cols
		});
		return this;
	}
	/**
	* Create an expression-based index.
	*
	* Allows indexing on SQL expressions rather than plain columns.
	* Useful for case-insensitive searches, computed values, etc.
	*
	* **Note**: PostgreSQL-specific feature. MongoDB will silently ignore this.
	*
	* @param expressions - SQL expression(s) to index
	* @param name - Optional index name
	* @param options - Optional index options (concurrently)
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* // Case-insensitive email index
	* this.expressionIndex(['lower(email)'], 'idx_email_lower');
	*
	* // Multiple expressions
	* this.expressionIndex(['lower(firstName)', 'lower(lastName)'], 'idx_name_lower');
	*
	* // With concurrent creation (requires transactional = false)
	* this.expressionIndex(['lower(email)'], 'idx_email_lower', { concurrently: true });
	* ```
	*/
	expressionIndex(expressions, name, options) {
		const exprs = Array.isArray(expressions) ? expressions : [expressions];
		this.pendingOperations.push({
			type: "createIndex",
			payload: {
				columns: [],
				expressions: exprs,
				name,
				concurrently: options?.concurrently
			}
		});
		return this;
	}
	/**
	* Create a full-text search index.
	*
	* @param columns - Column(s) to index
	* @param options - Full-text options
	* @returns This migration for chaining
	*/
	fullText(columns, options) {
		const cols = Array.isArray(columns) ? columns : [columns];
		this.pendingOperations.push({
			type: "createFullTextIndex",
			payload: {
				columns: cols,
				options
			}
		});
		return this;
	}
	/**
	* Drop a full-text search index.
	*
	* @param name - Index name
	* @returns This migration for chaining
	*/
	dropFullText(name) {
		this.pendingOperations.push({
			type: "dropFullTextIndex",
			payload: name
		});
		return this;
	}
	/**
	* Create a geo-spatial index.
	*
	* @param column - Geo column
	* @param options - Geo index options
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.geoIndex("location"); // 2dsphere index
	* this.geoIndex("coordinates", { type: "2d" }); // 2d index
	* ```
	*/
	geoIndex(column, options) {
		this.pendingOperations.push({
			type: "createGeoIndex",
			payload: {
				column,
				options
			}
		});
		return this;
	}
	/**
	* Drop a geo-spatial index.
	*
	* @param column - Geo column
	* @returns This migration for chaining
	*/
	dropGeoIndex(column) {
		this.pendingOperations.push({
			type: "dropGeoIndex",
			payload: column
		});
		return this;
	}
	/**
	* Create a vector search index for AI embeddings.
	*
	* @param column - Vector column
	* @param options - Vector index options
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.vectorIndex("embedding", {
	*   dimensions: 1536,
	*   similarity: "cosine",
	* });
	* ```
	*/
	vectorIndex(column, options) {
		this.pendingOperations.push({
			type: "createVectorIndex",
			payload: {
				column,
				options
			}
		});
		return this;
	}
	/**
	* Drop a vector search index.
	*
	* @param column - Vector column
	* @returns This migration for chaining
	*/
	dropVectorIndex(column) {
		this.pendingOperations.push({
			type: "dropVectorIndex",
			payload: column
		});
		return this;
	}
	/**
	* Create a TTL (time-to-live) index for automatic document expiration.
	*
	* Primarily for MongoDB. Documents are automatically deleted after the
	* specified time has passed since the date in the column.
	*
	* @param column - Date column to check for expiration
	* @param expireAfterSeconds - Seconds after which documents expire
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* // Delete sessions 24 hours after createdAt
	* this.ttlIndex("createdAt", 86400);
	* ```
	*/
	ttlIndex(column, expireAfterSeconds) {
		this.pendingOperations.push({
			type: "createTTLIndex",
			payload: {
				column,
				seconds: expireAfterSeconds
			}
		});
		return this;
	}
	/**
	* Drop a TTL index.
	*
	* @param column - Column with TTL
	* @returns This migration for chaining
	*/
	dropTTLIndex(column) {
		this.pendingOperations.push({
			type: "dropTTLIndex",
			payload: column
		});
		return this;
	}
	/**
	* Add a composite primary key.
	*
	* @param columns - Columns to include in the primary key
	* @returns This migration for chaining
	*/
	primaryKey(columns) {
		this.pendingOperations.push({
			type: "addPrimaryKey",
			payload: columns
		});
		return this;
	}
	/**
	* Drop the primary key constraint.
	*
	* @returns This migration for chaining
	*/
	dropPrimaryKey() {
		this.pendingOperations.push({
			type: "dropPrimaryKey",
			payload: null
		});
		return this;
	}
	/**
	* Add a CHECK constraint to the table.
	*
	* SQL-only feature. PostgreSQL, MySQL 8.0+, SQLite support this.
	* Validates that rows satisfy the given SQL expression.
	*
	* @param name - Constraint name
	* @param expression - SQL CHECK expression
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.check("age_positive", "age >= 0");
	* this.check("valid_email", "email LIKE '%@%'");
	* this.check("price_range", "price BETWEEN 0 AND 1000000");
	* ```
	*/
	check(name, expression) {
		this.pendingOperations.push({
			type: "addCheck",
			payload: {
				name,
				expression
			}
		});
		return this;
	}
	/**
	* Drop a CHECK constraint by name.
	*
	* @param name - Constraint name
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.dropCheck("age_positive");
	* ```
	*/
	dropCheck(name) {
		this.pendingOperations.push({
			type: "dropCheck",
			payload: name
		});
		return this;
	}
	/**
	* Start building a foreign key constraint on an existing column.
	*
	* Use this when adding a foreign key to a column that was defined in a
	* previous migration. For new columns, prefer the inline form:
	* `this.integer("user_id").references("users").onDelete("cascade")`
	*
	* SQL-only feature; NoSQL drivers ignore foreign keys.
	*
	* @param column - Local column that references another table
	* @returns Foreign key builder for chaining
	*
	* @example
	* ```typescript
	* this.foreign("user_id")
	*   .references("users", "id")
	*   .onDelete("cascade");
	* ```
	*/
	foreign(column) {
		return new ForeignKeyBuilder(this, column);
	}
	/**
	* Drop a foreign key constraint.
	*
	* Two calling forms:
	*
	* 1. Auto-compute the name (matches what `addForeignKey` generates):
	*    ```typescript
	*    this.dropForeign("unit_id", Unit.table);
	*    // → drops: fk_{table}_unit_id_units
	*    ```
	*
	* 2. Raw constraint name (use when the name was set explicitly):
	*    ```typescript
	*    this.dropForeign("my_custom_fk_name");
	*    ```
	*
	* @param columnOrConstraint - Column name (auto mode) or raw constraint name (raw mode)
	* @param referencesTable - Referenced table name; triggers auto-name computation when provided
	* @returns This migration for chaining
	*/
	dropForeign(columnOrConstraint, referencesTable) {
		const constraintName = referencesTable ? `fk_${this.table}_${columnOrConstraint}_${referencesTable}` : columnOrConstraint;
		this.pendingOperations.push({
			type: "dropForeignKey",
			payload: constraintName
		});
		return this;
	}
	/**
	* Set JSON schema validation rules on the collection.
	*
	* MongoDB-only feature. SQL databases ignore this.
	*
	* @param schema - JSON Schema object
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* this.schemaValidation({
	*   bsonType: "object",
	*   required: ["name", "email"],
	*   properties: {
	*     name: { bsonType: "string" },
	*     email: { bsonType: "string" },
	*   },
	* });
	* ```
	*/
	schemaValidation(schema) {
		this.pendingOperations.push({
			type: "setSchemaValidation",
			payload: schema
		});
		return this;
	}
	/**
	* Remove schema validation rules from the collection.
	*
	* @returns This migration for chaining
	*/
	dropSchemaValidation() {
		this.pendingOperations.push({
			type: "removeSchemaValidation",
			payload: null
		});
		return this;
	}
	/**
	* Execute raw operations with direct driver/connection access.
	*
	* Use this when you need to bypass the migration API entirely and
	* interact with the native database driver directly.
	*
	* @param callback - Callback receiving the native connection
	* @returns Result from callback
	*
	* @example
	* ```typescript
	* await this.withConnection(async (db) => {
	*   await db.collection("users").updateMany({}, { $set: { active: true } });
	* });
	* ```
	*/
	async withConnection(callback) {
		return this.driver.raw(callback);
	}
	/**
	* Queue a raw SQL string for execution within the migration.
	*
	* The statement is queued and executed in order with other migration
	* operations, within the transaction context if the migration is transactional.
	*
	* Use `withConnection()` instead if you need direct driver access.
	*
	* Works with PostgreSQL, MySQL, etc. For MongoDB, uses $eval command.
	*
	* @param sql - SQL statement to execute
	* @returns This migration for chaining
	*
	* @example
	* ```typescript
	* // Enable PostgreSQL extension
	* this.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
	*
	* // Create custom type
	* this.raw('CREATE TYPE mood AS ENUM (\'happy\', \'sad\', \'neutral\')');
	* ```
	*/
	raw(sql) {
		this.pendingOperations.push({
			type: "rawStatement",
			payload: sql
		});
		return this;
	}
	/**
	* Create a declarative initial-table migration.
	* Implemented and assigned below the class body.
	*/
	static create;
	/**
	* Create a declarative alteration migration.
	* Implemented and assigned below the class body.
	*/
	static alter;
};
function migrate(model, options) {
	return class AnonymousMigration extends Migration {
		static migrationName = options?.name;
		static createdAt = options?.createdAt;
		table = model.table;
		static transactional = options?.transactional;
		async up() {
			await options?.up?.call(this);
		}
		async down() {
			await options?.down?.call(this);
		}
	};
}
/**
* Wire a `ColumnMap` onto an active migration instance.
*
* Fixes up the placeholder column name in each `DetachedColumnBuilder`,
* pushes the `addColumn` operation, and transfers any pending FK / index
* side effects from the detached sink to the real migration.
*
* @internal
*/
function wireColumns(migration, columns) {
	for (const [columnName, detached] of Object.entries(columns)) {
		const definition = detached.getDefinition();
		definition.name = columnName;
		migration.pendingOperations.push({
			type: "addColumn",
			payload: definition
		});
		for (const idx of detached.sink.pendingIndexes) {
			idx.columns = idx.columns.map((col) => col === "__placeholder__" ? columnName : col);
			migration.addPendingIndex(idx);
		}
		for (const fk of detached.sink.pendingForeignKeys) {
			fk.column = columnName;
			migration.addForeignKeyOperation(fk);
		}
		if (detached.sink.pendingVectorIndexes) for (const vIdx of detached.sink.pendingVectorIndexes) {
			vIdx.column = columnName;
			migration.vectorIndex(vIdx.column, vIdx.options);
		}
	}
}
/**
* Create a declarative initial-table migration.
*
* Automatically handles:
* - `createTableIfNotExists()`
* - Primary key (type resolved from `migrationDefaults.primaryKey` → options → `"int"`)
* - `timestamps()`
* - `down()` → `dropTableIfExists()`
*
* The class-based API remains available for complex migrations (raw SQL,
* data backfills, conditional logic).
*
* @param model - Model class to bind (provides table name + data source)
* @param columns - Column definitions keyed by column name
* @param options - Optional overrides
*
* @example
* ```typescript
* import { Migration, uuid, text, timestamp } from "@warlock.js/cascade";
* import { Organization } from "app/organizations/models/organization";
* import { Chat } from "../chat.model";
*
* export default Migration.create(Chat, {
*   organization_id: uuid().references(Organization).onDelete("cascade"),
*   title:           text(),
*   status:          text(),
*   started_at:      timestamp().default("NOW()"),
*   closed_at:       timestamp().nullable(),
* }, { order: 5 });
* ```
*/
Migration.create = function createMigration(model, columns, options = {}) {
	const { order = 0, createdAt, primaryKey: primaryKeyOverride, timestamps: withTimestamps = true, transactional } = options;
	return class DeclarativeMigration extends Migration {
		static order = order;
		static createdAt = createdAt;
		static transactional = transactional;
		table = model.table;
		dataSource = model.dataSource;
		async up() {
			this.createTableIfNotExists();
			const pkType = primaryKeyOverride !== void 0 ? primaryKeyOverride : this._migrationDefaults?.primaryKey ?? "int";
			if (pkType === "uuid") this.primaryUuid();
			else if (pkType === "bigInt") this.bigId();
			else if (pkType === "int") this.id();
			wireColumns(this, columns);
			if (withTimestamps) this.timestamps();
			if (options.index) for (const entry of options.index) this.index(entry.columns, entry.name, {
				include: entry.include,
				concurrently: entry.concurrently
			});
			if (options.unique) for (const entry of options.unique) this.unique(entry.columns, entry.name, {
				include: entry.include,
				concurrently: entry.concurrently
			});
			if (options.raw) {
				const rawQueries = Array.isArray(options.raw) ? options.raw : [options.raw];
				for (const query of rawQueries) this.raw(query);
			}
			if (options.up) await options.up.call(this);
		}
		async down() {
			if (options.down) await options.down.call(this);
			this.dropTableIfExists();
		}
	};
};
/**
* Create a declarative alteration migration.
*
* @param model - Model class to bind
* @param schema - What to add / drop / rename / modify
* @param options - Optional overrides
*
* @example
* ```typescript
* import { Migration, text } from "@warlock.js/cascade";
* import { User } from "../user.model";
*
* export default Migration.alter(User, {
*   add: {
*     phone:  text().nullable(),
*     avatar: text().nullable(),
*   },
*   drop: ["legacy_field"],
*   rename: { old_name: "new_name" },
* });
* ```
*/
Migration.alter = function alterMigration(model, schema, options = {}) {
	const { order = 0, createdAt, transactional } = options;
	return class AlterMigration extends Migration {
		static order = order;
		static createdAt = createdAt;
		static transactional = transactional;
		table = model.table;
		dataSource = model.dataSource;
		async up() {
			if (schema.add) wireColumns(this, schema.add);
			if (schema.drop) for (const col of schema.drop) this.dropColumn(col);
			if (schema.rename) for (const [from, to] of Object.entries(schema.rename)) this.renameColumn(from, to);
			if (schema.modify) for (const [columnName, detached] of Object.entries(schema.modify)) {
				const definition = detached.getDefinition();
				definition.name = columnName;
				this.pendingOperations.push({
					type: "modifyColumn",
					payload: definition
				});
				for (const fk of detached.sink.pendingForeignKeys) {
					fk.column = columnName;
					this.addForeignKeyOperation(fk);
				}
			}
			if (schema.addIndex) for (const { columns, name, options: opts } of schema.addIndex) this.index(columns, name, opts);
			if (schema.dropIndex) for (const target of schema.dropIndex) this.dropIndex(target);
			if (schema.addUnique) for (const { columns, name, options: opts } of schema.addUnique) this.unique(columns, name, opts);
			if (schema.dropUnique) for (const cols of schema.dropUnique) this.dropUnique(cols);
			if (schema.addExpressionIndex) for (const { expressions, name, options: opts } of schema.addExpressionIndex) this.expressionIndex(expressions, name, opts);
			if (schema.addFullText) for (const { columns, options: opts } of schema.addFullText) this.fullText(columns, opts);
			if (schema.dropFullText) for (const name of schema.dropFullText) this.dropFullText(name);
			if (schema.addGeoIndex) for (const { column, options: opts } of schema.addGeoIndex) this.geoIndex(column, opts);
			if (schema.dropGeoIndex) for (const column of schema.dropGeoIndex) this.dropGeoIndex(column);
			if (schema.addVectorIndex) for (const { column, options: opts } of schema.addVectorIndex) this.vectorIndex(column, opts);
			if (schema.dropVectorIndex) for (const column of schema.dropVectorIndex) this.dropVectorIndex(column);
			if (schema.addTTLIndex) for (const { column, expireAfterSeconds } of schema.addTTLIndex) this.ttlIndex(column, expireAfterSeconds);
			if (schema.dropTTLIndex) for (const column of schema.dropTTLIndex) this.dropTTLIndex(column);
			if (schema.addForeign) for (const fk of schema.addForeign) {
				const tableName = typeof fk.references === "string" ? fk.references : fk.references.table;
				this.foreign(fk.column).references(tableName, fk.on ?? "id").onDelete(fk.onDelete ?? "restrict").onUpdate(fk.onUpdate ?? "restrict");
			}
			if (schema.dropForeign) for (const { columnOrConstraint, referencesTable } of schema.dropForeign) this.dropForeign(columnOrConstraint, referencesTable);
			if (schema.addCheck) for (const { name, expression } of schema.addCheck) this.check(name, expression);
			if (schema.dropCheck) for (const name of schema.dropCheck) this.dropCheck(name);
			if (schema.raw) {
				const rawQueries = Array.isArray(schema.raw) ? schema.raw : [schema.raw];
				for (const query of rawQueries) this.raw(query);
			}
			if (options.up) await options.up.call(this);
		}
		async down() {
			if (options.down) await options.down.call(this);
		}
	};
};
Migration.__declarativeFactoriesAttached = true;
//#endregion
export { Migration, migrate };

//# sourceMappingURL=migration.mjs.map