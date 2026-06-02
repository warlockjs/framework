import { databaseTransactionContext } from "../../context/database-transaction-context.mjs";
//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-migration-driver.ts
/**
* PostgreSQL Migration Driver
*
* Implements the MigrationDriverContract for PostgreSQL DDL operations.
* Provides methods for creating/dropping tables, columns, indexes,
* and constraints.
*
* @module cascade/drivers/postgres
*/
/**
* PostgreSQL Migration Driver.
*
* Handles database schema operations for PostgreSQL including:
* - Table creation and deletion
* - Column management
* - Index creation (B-tree, GIN, GiST, etc.)
* - Constraint management (foreign keys, unique, etc.)
*
* @example
* ```typescript
* const migrationDriver = driver.migrationDriver();
*
* // Create a table
* await migrationDriver.createTable('users');
*
* // Add columns
* await migrationDriver.addColumn('users', {
*   name: 'email',
*   type: 'string',
*   length: 255,
*   nullable: false
* });
*
* // Create unique index
* await migrationDriver.createUniqueIndex('users', ['email']);
* ```
*/
var PostgresMigrationDriver = class {
	driver;
	/**
	* Active transaction client (if any).
	*/
	get transactionClient() {
		return databaseTransactionContext.getSession();
	}
	/**
	* Create a new migration driver.
	*
	* @param driver - The PostgreSQL driver instance
	*/
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Create a new table with a default id column.
	*
	* @param table - Table name
	*/
	async createTable(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		await this.execute(`CREATE TABLE ${quotedTable} ()`);
	}
	/**
	* Create table if it doesn't exist.
	*
	* @param table - Table name
	*/
	async createTableIfNotExists(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		await this.execute(`CREATE TABLE IF NOT EXISTS ${quotedTable} ()`);
	}
	/**
	* Drop an existing table.
	*
	* @param table - Table name
	*/
	async dropTable(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		await this.execute(`DROP TABLE ${quotedTable} CASCADE`);
	}
	/**
	* Drop table if it exists.
	*
	* @param table - Table name
	*/
	async dropTableIfExists(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		await this.execute(`DROP TABLE IF EXISTS ${quotedTable} CASCADE`);
	}
	/**
	* Rename a table.
	*
	* @param from - Current table name
	* @param to - New table name
	*/
	async renameTable(from, to) {
		const quotedFrom = this.driver.dialect.quoteIdentifier(from);
		const quotedTo = this.driver.dialect.quoteIdentifier(to);
		await this.execute(`ALTER TABLE ${quotedFrom} RENAME TO ${quotedTo}`);
	}
	/**
	* Truncate a table — remove all rows efficiently.
	*
	* @param table - Table name
	*/
	async truncateTable(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		await this.execute(`TRUNCATE TABLE ${quotedTable}`);
	}
	/**
	* Check if a table exists.
	*
	* @param table - Table name
	* @returns Whether the table exists
	*/
	async tableExists(table) {
		return (await this.driver.query(`SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      )`, [table])).rows[0]?.exists ?? false;
	}
	/**
	* List all columns in a table.
	*
	* @param table - Table name
	* @returns Array of column definitions
	*/
	async listColumns(table) {
		return (await this.driver.query(`SELECT
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      ORDER BY ordinal_position`, [table])).rows.map((row) => ({
			name: row.column_name,
			type: this.mapPostgresTypeToColumnType(row.data_type),
			length: row.character_maximum_length ?? void 0,
			precision: row.numeric_precision ?? void 0,
			scale: row.numeric_scale ?? void 0,
			nullable: row.is_nullable === "YES",
			defaultValue: row.column_default ?? void 0
		}));
	}
	/**
	* List all tables in the current database.
	*
	* @returns Array of table names
	*/
	async listTables() {
		return (await this.driver.query(`SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`)).rows.map((row) => row.table_name);
	}
	/**
	* Ensure the migrations tracking table exists.
	*
	* Creates the table with proper schema if it doesn't exist.
	*
	* @param tableName - Name of the migrations table
	*/
	async ensureMigrationsTable(tableName) {
		const quotedTable = this.driver.dialect.quoteIdentifier(tableName);
		await this.execute(`
      CREATE TABLE IF NOT EXISTS ${quotedTable} (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL UNIQUE,
        "batch" INTEGER NOT NULL,
        "executedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMP WITH TIME ZONE
      )
    `);
	}
	/**
	* Add a column to an existing table.
	*
	* @param table - Table name
	* @param column - Column definition
	*/
	async addColumn(table, column) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column.name);
		let sqlType;
		if (column.autoIncrement) if (column.type === "bigInteger") sqlType = "BIGSERIAL";
		else sqlType = "SERIAL";
		else sqlType = this.driver.dialect.getSqlType(column.type, {
			length: column.length,
			precision: column.precision,
			scale: column.scale,
			dimensions: column.dimensions
		});
		let sql = `ALTER TABLE ${quotedTable} ADD COLUMN ${quotedColumn} ${sqlType}`;
		if (column.generated) {
			sql += ` GENERATED ALWAYS AS (${column.generated.expression})`;
			if (column.generated.stored) sql += " STORED";
		} else {
			if (!column.autoIncrement && column.nullable === false) sql += " NOT NULL";
			if (column.defaultValue !== void 0) if (typeof column.defaultValue === "object" && column.defaultValue !== null && column.defaultValue.__type === "CURRENT_TIMESTAMP") sql += " DEFAULT NOW()";
			else if (column.isRawDefault === false) {
				const escaped = String(column.defaultValue).replace(/'/g, "''");
				sql += ` DEFAULT '${escaped}'`;
			} else if (typeof column.defaultValue === "boolean") sql += ` DEFAULT ${column.defaultValue ? "TRUE" : "FALSE"}`;
			else if (typeof column.defaultValue === "number") sql += ` DEFAULT ${column.defaultValue}`;
			else sql += ` DEFAULT ${column.defaultValue}`;
			if (column.primary) sql += " PRIMARY KEY";
			if (column.unique) sql += " UNIQUE";
		}
		await this.execute(sql);
	}
	/**
	* Drop a column from a table.
	*
	* @param table - Table name
	* @param column - Column name
	*/
	async dropColumn(table, column) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column);
		await this.execute(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedColumn}`);
	}
	/**
	* Drop multiple columns from a table.
	*
	* @param table - Table name
	* @param columns - Column names
	*/
	async dropColumns(table, columns) {
		for (const column of columns) await this.dropColumn(table, column);
	}
	/**
	* Rename a column.
	*
	* @param table - Table name
	* @param from - Current column name
	* @param to - New column name
	*/
	async renameColumn(table, from, to) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedFrom = this.driver.dialect.quoteIdentifier(from);
		const quotedTo = this.driver.dialect.quoteIdentifier(to);
		await this.execute(`ALTER TABLE ${quotedTable} RENAME COLUMN ${quotedFrom} TO ${quotedTo}`);
	}
	/**
	* Modify an existing column.
	*
	* @param table - Table name
	* @param column - New column definition
	*/
	async modifyColumn(table, column) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column.name);
		const sqlType = this.driver.dialect.getSqlType(column.type, {
			length: column.length,
			precision: column.precision,
			scale: column.scale,
			dimensions: column.dimensions
		});
		await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} TYPE ${sqlType}`);
		if (column.nullable === false) await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} SET NOT NULL`);
		else if (column.nullable === true) await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} DROP NOT NULL`);
		if (column.defaultValue !== void 0) {
			let defaultVal;
			if (typeof column.defaultValue === "object" && column.defaultValue !== null && column.defaultValue.__type === "CURRENT_TIMESTAMP") defaultVal = "NOW()";
			else if (typeof column.defaultValue === "string") defaultVal = `'${column.defaultValue}'`;
			else defaultVal = String(column.defaultValue);
			await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} SET DEFAULT ${defaultVal}`);
		}
	}
	/**
	* Create standard timestamp columns (created_at, updated_at).
	*
	* PostgreSQL implementation creates TIMESTAMPTZ columns with NOW() defaults.
	*
	* @param table - Table name
	*/
	async createTimestampColumns(table) {
		await this.addColumn(table, {
			name: "created_at",
			type: "timestamp",
			nullable: false,
			defaultValue: "NOW()",
			isRawDefault: true
		});
		await this.addColumn(table, {
			name: "updated_at",
			type: "timestamp",
			nullable: false,
			defaultValue: "NOW()",
			isRawDefault: true
		});
	}
	/**
	* Create an index on one or more columns.
	*
	* Supports:
	* - Regular column indexes
	* - Expression-based indexes (e.g., `lower(email)`)
	* - Covering indexes (INCLUDE clause)
	* - Concurrent index creation (CONCURRENTLY keyword)
	*
	* @param table - Table name
	* @param index - Index definition
	*/
	async createIndex(table, index) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const indexName = index.name ?? `idx_${table}_${index.columns.join("_")}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		const uniqueKeyword = index.unique ? "UNIQUE " : "";
		const concurrentlyKeyword = index.concurrently ? "CONCURRENTLY " : "";
		let columnsPart;
		if (index.expressions && index.expressions.length > 0) columnsPart = index.expressions.map((expr) => `(${expr})`).join(", ");
		else columnsPart = index.columns.map((col, i) => {
			const quotedCol = this.driver.dialect.quoteIdentifier(col);
			const direction = index.directions?.[i]?.toUpperCase() ?? "";
			return direction ? `${quotedCol} ${direction}` : quotedCol;
		}).join(", ");
		let sql = `CREATE ${uniqueKeyword}INDEX ${concurrentlyKeyword}${quotedIndexName} ON ${quotedTable} (${columnsPart})`;
		if (index.include && index.include.length > 0) {
			const includeCols = index.include.map((col) => this.driver.dialect.quoteIdentifier(col)).join(", ");
			sql += ` INCLUDE (${includeCols})`;
		}
		if (index.where && Object.keys(index.where).length > 0) {
			const conditions = Object.entries(index.where).map(([key, value]) => {
				const quotedKey = this.driver.dialect.quoteIdentifier(key);
				return typeof value === "string" ? `${quotedKey} = '${value}'` : `${quotedKey} = ${value}`;
			}).join(" AND ");
			sql += ` WHERE ${conditions}`;
		}
		await this.execute(sql);
	}
	/**
	* Drop an index.
	*
	* @param table - Table name
	* @param indexNameOrColumns - Index name or columns
	*/
	async dropIndex(table, indexNameOrColumns) {
		let indexName;
		if (typeof indexNameOrColumns === "string") indexName = indexNameOrColumns;
		else indexName = `idx_${table}_${indexNameOrColumns.join("_")}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		await this.execute(`DROP INDEX IF EXISTS ${quotedIndexName}`);
	}
	/**
	* Create a unique index.
	*
	* @param table - Table name
	* @param columns - Columns to include
	* @param name - Optional index name
	*/
	async createUniqueIndex(table, columns, name) {
		await this.createIndex(table, {
			columns,
			unique: true,
			name
		});
	}
	/**
	* Drop a unique index.
	*
	* @param table - Table name
	* @param columns - Columns in the index
	*/
	async dropUniqueIndex(table, columns) {
		await this.dropIndex(table, columns);
	}
	/**
	* Create a full-text search index using GIN.
	*
	* @param table - Table name
	* @param columns - Columns to index
	* @param options - Full-text options
	*/
	async createFullTextIndex(table, columns, options) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const indexName = options?.name ?? `idx_${table}_fulltext_${columns.join("_")}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		const language = options?.language ?? "english";
		const tsvectors = columns.map((col) => {
			const weight = options?.weights?.[col] ?? "A";
			return `setweight(to_tsvector('${language}', COALESCE(${this.driver.dialect.quoteIdentifier(col)}, '')), '${weight}')`;
		});
		await this.execute(`CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING GIN ((${tsvectors.join(" || ")}))`);
	}
	/**
	* Drop a full-text search index.
	*
	* @param table - Table name
	* @param name - Index name
	*/
	async dropFullTextIndex(table, name) {
		await this.dropIndex(table, name);
	}
	/**
	* Create a geo-spatial index using GiST.
	*
	* @param table - Table name
	* @param column - Geo column
	* @param options - Geo index options
	*/
	async createGeoIndex(table, column, options) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column);
		const indexName = options?.name ?? `idx_${table}_geo_${column}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		await this.execute(`CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING GIST (${quotedColumn})`);
	}
	/**
	* Drop a geo-spatial index.
	*
	* @param table - Table name
	* @param column - Geo column
	*/
	async dropGeoIndex(table, column) {
		await this.dropIndex(table, `idx_${table}_geo_${column}`);
	}
	/**
	* Create a vector search index (requires pgvector extension).
	*
	* @param table - Table name
	* @param column - Vector column
	* @param options - Vector index options
	*/
	async createVectorIndex(table, column, options) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column);
		const indexName = options.name ?? `idx_${table}_vector_${column}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		const opClass = options.similarity === "euclidean" ? "vector_l2_ops" : options.similarity === "dotProduct" ? "vector_ip_ops" : "vector_cosine_ops";
		const lists = options.lists ?? 100;
		await this.execute(`CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING ivfflat (${quotedColumn} ${opClass}) WITH (lists = ${lists})`);
	}
	/**
	* Drop a vector search index.
	*
	* @param table - Table name
	* @param column - Vector column
	*/
	async dropVectorIndex(table, column) {
		await this.dropIndex(table, `idx_${table}_vector_${column}`);
	}
	/**
	* Create a TTL index (not natively supported in PostgreSQL).
	*
	* Note: PostgreSQL doesn't have native TTL indexes like MongoDB.
	* This creates a partial index and requires a scheduled job for cleanup.
	*
	* @param table - Table name
	* @param column - Date column
	* @param expireAfterSeconds - Expiration time in seconds
	*/
	async createTTLIndex(table, column, expireAfterSeconds) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(column);
		const indexName = `idx_${table}_ttl_${column}`;
		const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
		await this.execute(`CREATE INDEX ${quotedIndexName} ON ${quotedTable} (${quotedColumn}) WHERE ${quotedColumn} < NOW() - INTERVAL '${expireAfterSeconds} seconds'`);
	}
	/**
	* Drop a TTL index.
	*
	* @param table - Table name
	* @param column - Column with TTL index
	*/
	async dropTTLIndex(table, column) {
		await this.dropIndex(table, `idx_${table}_ttl_${column}`);
	}
	/**
	* List all indexes on a table.
	*
	* @param table - Table name
	* @returns Array of index metadata
	*/
	async listIndexes(table) {
		return (await this.driver.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, [table])).rows.map((row) => {
			const isUnique = row.indexdef.includes("UNIQUE");
			const isPrimary = row.indexname.endsWith("_pkey");
			const columnsMatch = row.indexdef.match(/\(([^)]+)\)/);
			const columns = columnsMatch ? columnsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];
			let type = "btree";
			if (row.indexdef.includes("USING GIN")) type = "gin";
			else if (row.indexdef.includes("USING GIST")) type = "gist";
			else if (row.indexdef.includes("USING HASH")) type = "hash";
			else if (row.indexdef.includes("USING ivfflat")) type = "ivfflat";
			return {
				name: row.indexname,
				columns,
				type,
				unique: isUnique || isPrimary,
				partial: row.indexdef.includes("WHERE"),
				options: {
					primary: isPrimary,
					definition: row.indexdef
				}
			};
		});
	}
	/**
	* Check if a PostgreSQL extension is available on the database server.
	*
	* @param extension - Extension name (e.g., "vector")
	*/
	async isExtensionAvailable(extension) {
		try {
			return (await this.driver.query(`SELECT name FROM pg_available_extensions WHERE name = $1`, [extension]))?.rows?.length > 0;
		} catch {
			return true;
		}
	}
	/**
	* Get the official documentation or installation URL for a PostgreSQL extension.
	*
	* @param extension - Extension name
	*/
	getExtensionDocsUrl(extension) {
		return {
			vector: "https://github.com/pgvector/pgvector#installation",
			postgis: "https://postgis.net/documentation/getting_started/",
			pg_trgm: "https://www.postgresql.org/docs/current/pgtrgm.html",
			uuid_ossp: "https://www.postgresql.org/docs/current/uuid-ossp.html"
		}[extension] ?? `https://www.postgresql.org/docs/current/${extension}.html`;
	}
	/**
	* Add a foreign key constraint.
	*
	* @param table - Table name
	* @param foreignKey - Foreign key definition
	*/
	async addForeignKey(table, foreignKey) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumn = this.driver.dialect.quoteIdentifier(foreignKey.column);
		const quotedRefTable = this.driver.dialect.quoteIdentifier(foreignKey.referencesTable);
		const quotedRefColumn = this.driver.dialect.quoteIdentifier(foreignKey.referencesColumn);
		const constraintName = foreignKey.name ?? `fk_${table}_${foreignKey.column}_${foreignKey.referencesTable}`;
		let sql = `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${this.driver.dialect.quoteIdentifier(constraintName)} FOREIGN KEY (${quotedColumn}) REFERENCES ${quotedRefTable} (${quotedRefColumn})`;
		if (foreignKey.onDelete) sql += ` ON DELETE ${this.mapForeignKeyAction(foreignKey.onDelete)}`;
		if (foreignKey.onUpdate) sql += ` ON UPDATE ${this.mapForeignKeyAction(foreignKey.onUpdate)}`;
		await this.execute(sql);
	}
	/**
	* Drop a foreign key constraint.
	*
	* @param table - Table name
	* @param name - Constraint name
	*/
	async dropForeignKey(table, name) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedConstraint = this.driver.dialect.quoteIdentifier(name);
		await this.execute(`ALTER TABLE ${quotedTable} DROP CONSTRAINT ${quotedConstraint}`);
	}
	/**
	* Add a primary key constraint.
	*
	* @param table - Table name
	* @param columns - Primary key columns
	*/
	async addPrimaryKey(table, columns) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedColumns = columns.map((c) => this.driver.dialect.quoteIdentifier(c)).join(", ");
		const constraintName = `pk_${table}`;
		const quotedConstraint = this.driver.dialect.quoteIdentifier(constraintName);
		await this.execute(`ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quotedConstraint} PRIMARY KEY (${quotedColumns})`);
	}
	/**
	* Drop the primary key constraint.
	*
	* @param table - Table name
	*/
	async dropPrimaryKey(table) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const constraintName = `pk_${table}`;
		const quotedConstraint = this.driver.dialect.quoteIdentifier(constraintName);
		await this.execute(`ALTER TABLE ${quotedTable} DROP CONSTRAINT ${quotedConstraint}`);
	}
	/**
	* Add a CHECK constraint.
	*
	* @param table - Table name
	* @param name - Constraint name
	* @param expression - SQL CHECK expression
	*/
	async addCheck(table, name, expression) {
		const sql = `ALTER TABLE ${this.driver.dialect.quoteIdentifier(table)} ADD CONSTRAINT ${this.driver.dialect.quoteIdentifier(name)} CHECK (${expression})`;
		await this.execute(sql);
	}
	/**
	* Drop a CHECK constraint.
	*
	* @param table - Table name
	* @param name - Constraint name
	*/
	async dropCheck(table, name) {
		const quotedTable = this.driver.dialect.quoteIdentifier(table);
		const quotedName = this.driver.dialect.quoteIdentifier(name);
		await this.execute(`ALTER TABLE ${quotedTable} DROP CONSTRAINT ${quotedName}`);
	}
	/**
	* Set schema validation (no-op for PostgreSQL).
	*
	* PostgreSQL uses column constraints instead.
	*/
	async setSchemaValidation(_table, _schema) {}
	/**
	* Remove schema validation (no-op for PostgreSQL).
	*/
	async removeSchemaValidation(_table) {}
	/**
	* Begin a transaction.
	*/
	async beginTransaction() {
		await this.execute("BEGIN");
	}
	/**
	* Commit the current transaction.
	*/
	async commit() {
		await this.execute("COMMIT");
	}
	/**
	* Rollback the current transaction.
	*/
	async rollback() {
		await this.execute("ROLLBACK");
	}
	/**
	* Whether transactions are supported.
	*/
	supportsTransactions() {
		return true;
	}
	/**
	* Get the default transactional behavior for PostgreSQL.
	*
	* PostgreSQL supports transactional DDL operations, so migrations
	* are wrapped in transactions by default for atomicity and safety.
	*
	* @returns true (PostgreSQL DDL is transactional)
	*/
	getDefaultTransactional() {
		return true;
	}
	/**
	* Get the default UUID generation expression for PostgreSQL.
	*
	* Resolution order:
	* 1. `migrationDefaults.uuidExpression` → raw expression (escape hatch)
	* 2. `migrationDefaults.uuidStrategy` → mapped to PG function
	* 3. Fallback → `gen_random_uuid()` (v4, PG 13+)
	*
	* @param migrationDefaults - Optional overrides from DataSource config
	* @returns PostgreSQL SQL expression for UUID generation
	*
	* @example
	* ```typescript
	* driver.getUuidDefault(); // "gen_random_uuid()"
	* driver.getUuidDefault({ uuidStrategy: "v7" }); // "uuidv7()"
	* driver.getUuidDefault({ uuidExpression: "uuid_generate_v1mc()" }); // "uuid_generate_v1mc()"
	* ```
	*/
	getUuidDefault(migrationDefaults) {
		if (migrationDefaults?.uuidExpression) return migrationDefaults.uuidExpression;
		return {
			v4: "gen_random_uuid()",
			v7: "uuidv7()"
		}[migrationDefaults?.uuidStrategy ?? "v4"];
	}
	/**
	* Execute raw operations with direct driver access.
	*
	* @param callback - Callback receiving the driver
	*/
	async raw(callback) {
		return callback(this.driver);
	}
	/**
	* Execute a SQL statement.
	*
	* @param sql - SQL to execute
	* @param params - Query parameters
	*/
	async execute(sql, params = []) {
		await this.driver.query(sql, params);
	}
	/**
	* Map foreign key action to PostgreSQL syntax.
	*/
	mapForeignKeyAction(action) {
		return {
			cascade: "CASCADE",
			restrict: "RESTRICT",
			setNull: "SET NULL",
			noAction: "NO ACTION"
		}[action] ?? "NO ACTION";
	}
	/**
	* Map PostgreSQL data type to ColumnType.
	*/
	mapPostgresTypeToColumnType(pgType) {
		return {
			"character varying": "string",
			varchar: "string",
			character: "char",
			char: "char",
			text: "text",
			integer: "integer",
			int: "integer",
			smallint: "smallInteger",
			bigint: "bigInteger",
			real: "float",
			"double precision": "double",
			numeric: "decimal",
			decimal: "decimal",
			boolean: "boolean",
			date: "date",
			timestamp: "dateTime",
			"timestamp without time zone": "dateTime",
			"timestamp with time zone": "timestamp",
			time: "time",
			"time without time zone": "time",
			json: "json",
			jsonb: "json",
			bytea: "binary",
			uuid: "uuid",
			inet: "ipAddress",
			macaddr: "macAddress",
			point: "point",
			polygon: "polygon",
			line: "lineString",
			geometry: "geometry",
			"integer[]": "arrayInt",
			"int[]": "arrayInt",
			"bigint[]": "arrayBigInt",
			"real[]": "arrayFloat",
			"decimal[]": "arrayDecimal",
			"numeric[]": "arrayDecimal",
			"boolean[]": "arrayBoolean",
			"text[]": "arrayText",
			"date[]": "arrayDate",
			"timestamp with time zone[]": "arrayTimestamp",
			"timestamptz[]": "arrayTimestamp",
			"uuid[]": "arrayUuid",
			"jsonb[]": "arrayJson",
			"json[]": "arrayJson"
		}[pgType.toLowerCase()] ?? "string";
	}
};
//#endregion
export { PostgresMigrationDriver };

//# sourceMappingURL=postgres-migration-driver.mjs.map