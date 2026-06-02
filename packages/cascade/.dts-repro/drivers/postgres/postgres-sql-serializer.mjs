import { SQLSerializer } from "../../migration/sql-serializer.mjs";
//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-sql-serializer.ts
/**
* PostgreSQL-specific SQL serializer.
*
* Converts pending migration operations into valid PostgreSQL DDL statements.
*/
var PostgresSQLSerializer = class extends SQLSerializer {
	dialect;
	constructor(dialect) {
		super();
		this.dialect = dialect;
	}
	serialize(operation, table) {
		switch (operation.type) {
			case "createTable": return this.createTable(table);
			case "createTableIfNotExists": return this.createTableIfNotExists(table);
			case "dropTable": return this.dropTable(table);
			case "dropTableIfExists": return this.dropTableIfExists(table);
			case "renameTable": return this.renameTable(table, operation.payload);
			case "truncateTable": return this.truncateTable(table);
			case "addColumn": return this.addColumn(table, operation.payload);
			case "dropColumn": return this.dropColumn(table, operation.payload);
			case "dropColumns": return this.dropColumns(table, operation.payload);
			case "renameColumn": {
				const payload = operation.payload;
				return this.renameColumn(table, payload.from, payload.to);
			}
			case "modifyColumn": return this.modifyColumn(table, operation.payload);
			case "createIndex": return this.createIndex(table, operation.payload);
			case "dropIndex": return this.dropIndex(table, operation.payload);
			case "createUniqueIndex": {
				const payload = operation.payload;
				return this.createIndex(table, {
					columns: payload.columns,
					name: payload.name,
					unique: true
				});
			}
			case "dropUniqueIndex": return this.dropIndex(table, operation.payload);
			case "createFullTextIndex": {
				const payload = operation.payload;
				return this.createFullTextIndex(table, payload.columns, payload.options);
			}
			case "dropFullTextIndex": return this.dropIndex(table, operation.payload);
			case "createGeoIndex": {
				const payload = operation.payload;
				return this.createGeoIndex(table, payload.column, payload.options);
			}
			case "dropGeoIndex": return this.dropIndex(table, `idx_${table}_geo_${operation.payload}`);
			case "createVectorIndex": {
				const payload = operation.payload;
				return this.createVectorIndex(table, payload.column, payload.options);
			}
			case "dropVectorIndex": return this.dropIndex(table, `idx_${table}_vector_${operation.payload}`);
			case "createTTLIndex": {
				const payload = operation.payload;
				return this.createTTLIndex(table, payload.column, payload.expireAfterSeconds);
			}
			case "dropTTLIndex": return this.dropIndex(table, `idx_${table}_ttl_${operation.payload}`);
			case "addForeignKey": return this.addForeignKey(table, operation.payload);
			case "dropForeignKey": return this.dropForeignKey(table, operation.payload);
			case "addPrimaryKey": return this.addPrimaryKey(table, operation.payload);
			case "dropPrimaryKey": return this.dropPrimaryKey(table);
			case "addCheck": return null;
			case "dropCheck": return null;
			case "createTimestamps": return this.createTimestamps(table);
			case "rawStatement": return operation.payload;
			case "setSchemaValidation":
			case "removeSchemaValidation": return null;
			default: return null;
		}
	}
	createTable(table) {
		return `CREATE TABLE ${this.dialect.quoteIdentifier(table)} ()`;
	}
	createTableIfNotExists(table) {
		return `CREATE TABLE IF NOT EXISTS ${this.dialect.quoteIdentifier(table)} ()`;
	}
	dropTable(table) {
		return `DROP TABLE ${this.dialect.quoteIdentifier(table)} CASCADE`;
	}
	dropTableIfExists(table) {
		return `DROP TABLE IF EXISTS ${this.dialect.quoteIdentifier(table)} CASCADE`;
	}
	renameTable(from, to) {
		return `ALTER TABLE ${this.dialect.quoteIdentifier(from)} RENAME TO ${this.dialect.quoteIdentifier(to)}`;
	}
	truncateTable(table) {
		return `TRUNCATE TABLE ${this.dialect.quoteIdentifier(table)}`;
	}
	addColumn(table, column) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column.name);
		let sqlType;
		if (column.autoIncrement) if (column.type === "bigInteger") sqlType = "BIGSERIAL";
		else sqlType = "SERIAL";
		else sqlType = this.dialect.getSqlType(column.type, {
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
		if (column.type === "vector") return ["CREATE EXTENSION IF NOT EXISTS vector", sql];
		return sql;
	}
	dropColumn(table, column) {
		return `ALTER TABLE ${this.dialect.quoteIdentifier(table)} DROP COLUMN ${this.dialect.quoteIdentifier(column)}`;
	}
	dropColumns(table, columns) {
		return `ALTER TABLE ${this.dialect.quoteIdentifier(table)} ${columns.map((col) => `DROP COLUMN ${this.dialect.quoteIdentifier(col)}`).join(", ")}`;
	}
	renameColumn(table, from, to) {
		return `ALTER TABLE ${this.dialect.quoteIdentifier(table)} RENAME COLUMN ${this.dialect.quoteIdentifier(from)} TO ${this.dialect.quoteIdentifier(to)}`;
	}
	modifyColumn(table, column) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column.name);
		const sqlType = this.dialect.getSqlType(column.type, {
			length: column.length,
			precision: column.precision,
			scale: column.scale,
			dimensions: column.dimensions
		});
		const alters = [];
		alters.push(`ALTER COLUMN ${quotedColumn} TYPE ${sqlType}`);
		if (column.nullable === false) alters.push(`ALTER COLUMN ${quotedColumn} SET NOT NULL`);
		else if (column.nullable === true) alters.push(`ALTER COLUMN ${quotedColumn} DROP NOT NULL`);
		if (column.defaultValue !== void 0) {
			let defaultVal;
			if (typeof column.defaultValue === "object" && column.defaultValue !== null && column.defaultValue.__type === "CURRENT_TIMESTAMP") defaultVal = "NOW()";
			else if (typeof column.defaultValue === "string") defaultVal = `'${column.defaultValue}'`;
			else defaultVal = String(column.defaultValue);
			alters.push(`ALTER COLUMN ${quotedColumn} SET DEFAULT ${defaultVal}`);
		}
		return `ALTER TABLE ${quotedTable} ${alters.join(", ")}`;
	}
	createTimestamps(table) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		return [`ALTER TABLE ${quotedTable} ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `ALTER TABLE ${quotedTable} ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`];
	}
	createIndex(table, index) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		let indexName;
		if (index.name) indexName = index.name;
		else indexName = `idx_${table}_${Array.isArray(index.columns) ? index.columns.join("_") : index.columns}`;
		const quotedIndexName = this.dialect.quoteIdentifier(indexName);
		const uniqueKeyword = index.unique ? "UNIQUE " : "";
		const concurrentlyKeyword = index.concurrently ? "CONCURRENTLY " : "";
		let columnsPart;
		if (index.expressions && index.expressions.length > 0) columnsPart = index.expressions.map((expr) => `(${expr})`).join(", ");
		else columnsPart = index.columns.map((col, i) => {
			const quotedCol = this.dialect.quoteIdentifier(col);
			const direction = index.directions?.[i]?.toUpperCase() ?? "";
			return direction ? `${quotedCol} ${direction}` : quotedCol;
		}).join(", ");
		let sql = `CREATE ${uniqueKeyword}INDEX ${concurrentlyKeyword}${quotedIndexName} ON ${quotedTable} (${columnsPart})`;
		if (index.include && index.include.length > 0) {
			const includeCols = index.include.map((col) => this.dialect.quoteIdentifier(col)).join(", ");
			sql += ` INCLUDE (${includeCols})`;
		}
		if (index.where && Object.keys(index.where).length > 0) {
			const conditions = Object.entries(index.where).map(([key, value]) => {
				const quotedKey = this.dialect.quoteIdentifier(key);
				return typeof value === "string" ? `${quotedKey} = '${value}'` : `${quotedKey} = ${value}`;
			}).join(" AND ");
			sql += ` WHERE ${conditions}`;
		}
		return sql;
	}
	dropIndex(table, indexNameOrColumns) {
		let indexName;
		if (typeof indexNameOrColumns === "string") indexName = indexNameOrColumns;
		else indexName = `idx_${table}_${indexNameOrColumns.join("_")}`;
		return `DROP INDEX IF EXISTS ${this.dialect.quoteIdentifier(indexName)}`;
	}
	createFullTextIndex(table, columns, options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const indexName = options?.name ?? `idx_${table}_fulltext_${columns.join("_")}`;
		const quotedIndexName = this.dialect.quoteIdentifier(indexName);
		const language = options?.language ?? "english";
		return `CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING GIN ((${columns.map((col) => {
			const weight = options?.weights?.[col] ?? "A";
			return `setweight(to_tsvector('${language}', COALESCE(${this.dialect.quoteIdentifier(col)}, '')), '${weight}')`;
		}).join(" || ")}))`;
	}
	createGeoIndex(table, column, options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column);
		const indexName = options?.name ?? `idx_${table}_geo_${column}`;
		return `CREATE INDEX ${this.dialect.quoteIdentifier(indexName)} ON ${quotedTable} USING GIST (${quotedColumn})`;
	}
	createVectorIndex(table, column, options) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column);
		const indexName = options.name ?? `idx_${table}_vector_${column}`;
		return `CREATE INDEX ${this.dialect.quoteIdentifier(indexName)} ON ${quotedTable} USING ivfflat (${quotedColumn} ${options.similarity === "euclidean" ? "vector_l2_ops" : options.similarity === "dotProduct" ? "vector_ip_ops" : "vector_cosine_ops"}) WITH (lists = ${options.lists ?? 100})`;
	}
	createTTLIndex(table, column, expireAfterSeconds) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column);
		const indexName = `idx_${table}_ttl_${column}`;
		return `CREATE INDEX ${this.dialect.quoteIdentifier(indexName)} ON ${quotedTable} (${quotedColumn}) WHERE ${quotedColumn} < NOW() - INTERVAL '${expireAfterSeconds} seconds'`;
	}
	addForeignKey(table, foreignKey) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(foreignKey.column);
		const quotedRefTable = this.dialect.quoteIdentifier(foreignKey.referencesTable);
		const quotedRefColumn = this.dialect.quoteIdentifier(foreignKey.referencesColumn);
		const constraintName = foreignKey.name ?? `fk_${table}_${foreignKey.column}_${foreignKey.referencesTable}`;
		let sql = `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${this.dialect.quoteIdentifier(constraintName)} FOREIGN KEY (${quotedColumn}) REFERENCES ${quotedRefTable} (${quotedRefColumn})`;
		if (foreignKey.onDelete) sql += ` ON DELETE ${this.mapForeignKeyAction(foreignKey.onDelete)}`;
		if (foreignKey.onUpdate) sql += ` ON UPDATE ${this.mapForeignKeyAction(foreignKey.onUpdate)}`;
		return sql;
	}
	dropForeignKey(table, name) {
		return `ALTER TABLE ${this.dialect.quoteIdentifier(table)} DROP CONSTRAINT ${this.dialect.quoteIdentifier(name)}`;
	}
	addPrimaryKey(table, columns) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumns = columns.map((c) => this.dialect.quoteIdentifier(c)).join(", ");
		const constraintName = `pk_${table}`;
		return `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${this.dialect.quoteIdentifier(constraintName)} PRIMARY KEY (${quotedColumns})`;
	}
	dropPrimaryKey(table) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const constraintName = `pk_${table}`;
		return `ALTER TABLE ${quotedTable} DROP CONSTRAINT ${this.dialect.quoteIdentifier(constraintName)}`;
	}
	mapForeignKeyAction(action) {
		switch (action) {
			case "cascade": return "CASCADE";
			case "restrict": return "RESTRICT";
			case "setNull": return "SET NULL";
			case "noAction": return "NO ACTION";
			default: return "NO ACTION";
		}
	}
};
//#endregion
export { PostgresSQLSerializer };

//# sourceMappingURL=postgres-sql-serializer.mjs.map