//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-dialect.ts
/**
* PostgreSQL-specific SQL dialect implementation.
*
* Provides PostgreSQL syntax for:
* - Parameter placeholders ($1, $2, $3...)
* - Identifier quoting with double quotes
* - JSONB operators (->, ->>, @>)
* - ILIKE for case-insensitive matching
* - RETURNING clause support
*
* @example
* ```typescript
* const dialect = new PostgresDialect();
*
* dialect.placeholder(1); // "$1"
* dialect.quoteIdentifier('user'); // '"user"'
* dialect.jsonExtract('data', 'name'); // "data"->>'name'
* ```
*/
var PostgresDialect = class {
	/**
	* Dialect name identifier.
	*/
	name = "postgres";
	/**
	* PostgreSQL supports the RETURNING clause for INSERT/UPDATE/DELETE.
	*/
	supportsReturning = true;
	/**
	* PostgreSQL uses ON CONFLICT for upsert operations.
	*/
	upsertKeyword = "ON CONFLICT";
	/**
	* Generate a PostgreSQL parameter placeholder.
	*
	* PostgreSQL uses numbered placeholders: $1, $2, $3, etc.
	*
	* @param index - The 1-based parameter index
	* @returns The placeholder string (e.g., "$1")
	*/
	placeholder(index) {
		return `$${index}`;
	}
	/**
	* Quote an identifier using PostgreSQL's double-quote syntax.
	*
	* Handles escaping of embedded double quotes by doubling them.
	* This is necessary for reserved words and special characters.
	*
	* @param identifier - The identifier (table/column name) to quote
	* @returns The quoted identifier (e.g., '"user"')
	*/
	quoteIdentifier(identifier) {
		return identifier.split(".").map((part) => `"${part.replace(/"/g, "\"\"")}"`).join(".");
	}
	/**
	* Convert a boolean to PostgreSQL literal.
	*
	* @param value - The boolean value
	* @returns "TRUE" or "FALSE"
	*/
	booleanLiteral(value) {
		return value ? "TRUE" : "FALSE";
	}
	/**
	* Build LIMIT/OFFSET clause for PostgreSQL.
	*
	* @param limit - Maximum rows to return
	* @param offset - Rows to skip
	* @returns The SQL clause (e.g., "LIMIT 10 OFFSET 20")
	*/
	limitOffset(limit, offset) {
		const parts = [];
		if (limit !== void 0) parts.push(`LIMIT ${limit}`);
		if (offset !== void 0) parts.push(`OFFSET ${offset}`);
		return parts.join(" ");
	}
	/**
	* Build a JSON path extraction expression for PostgreSQL.
	*
	* Uses the ->> operator for text extraction from JSONB columns.
	* Supports nested paths using chained operators.
	*
	* @param column - The JSONB column name
	* @param path - The path to extract (dot notation: "user.name")
	* @returns The SQL expression (e.g., "data"->>'user'->>'name')
	*/
	jsonExtract(column, path) {
		const quotedColumn = this.quoteIdentifier(column);
		const pathParts = path.split(".");
		if (pathParts.length === 1) return `${quotedColumn}->>'${pathParts[0]}'`;
		return `${quotedColumn}->${pathParts.slice(0, -1).map((p) => `'${p}'`).join("->")}->>'${pathParts[pathParts.length - 1]}'`;
	}
	/**
	* Build a JSON contains expression for PostgreSQL.
	*
	* Uses the @> containment operator for JSONB columns.
	*
	* @param column - The JSONB column name
	* @param value - The value to check for
	* @param path - Optional path within the JSON
	* @returns The SQL expression
	*/
	jsonContains(column, value, path) {
		const quotedColumn = this.quoteIdentifier(column);
		if (path) return `${quotedColumn} @> '${JSON.stringify({ [path]: value })}'::jsonb`;
		return `${quotedColumn} @> '${JSON.stringify(value)}'::jsonb`;
	}
	/**
	* Build a LIKE pattern expression for PostgreSQL.
	*
	* Uses ILIKE for case-insensitive matching, LIKE for case-sensitive.
	*
	* @param pattern - The pattern to match
	* @param caseInsensitive - Whether to use case-insensitive matching
	* @returns Object with operator and pattern
	*/
	likePattern(pattern, caseInsensitive = true) {
		const escapedPattern = pattern.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
		return {
			operator: caseInsensitive ? "ILIKE" : "LIKE",
			pattern: escapedPattern
		};
	}
	/**
	* Build an array contains expression for PostgreSQL.
	*
	* Uses ANY() for checking if a value is in an array column.
	*
	* @param column - The array column name
	* @param paramIndex - The parameter index
	* @returns The SQL expression
	*/
	arrayContains(column, paramIndex) {
		return `${this.placeholder(paramIndex)} = ANY(${this.quoteIdentifier(column)})`;
	}
	/**
	* Get the PostgreSQL SQL type for an abstract type.
	*
	* @param type - The abstract type name
	* @param options - Type-specific options
	* @returns The PostgreSQL type string
	*/
	getSqlType(type, options) {
		switch (type) {
			case "string": return options?.length ? `VARCHAR(${options.length})` : "TEXT";
			case "char": return `CHAR(${options?.length ?? 1})`;
			case "text": return "TEXT";
			case "mediumText":
			case "longText": return "TEXT";
			case "integer": return "INTEGER";
			case "smallInteger": return "SMALLINT";
			case "tinyInteger": return "SMALLINT";
			case "bigInteger": return "BIGINT";
			case "float": return "REAL";
			case "double": return "DOUBLE PRECISION";
			case "decimal":
				if (options?.precision !== void 0) {
					const scale = options.scale ?? 0;
					return `DECIMAL(${options.precision}, ${scale})`;
				}
				return "DECIMAL";
			case "boolean": return "BOOLEAN";
			case "date": return "DATE";
			case "dateTime": return "TIMESTAMP";
			case "timestamp": return "TIMESTAMPTZ";
			case "time": return "TIME";
			case "year": return "SMALLINT";
			case "json": return "JSONB";
			case "binary": return "BYTEA";
			case "uuid": return "UUID";
			case "ulid": return "CHAR(26)";
			case "ipAddress": return "INET";
			case "macAddress": return "MACADDR";
			case "point": return "POINT";
			case "polygon": return "POLYGON";
			case "lineString": return "PATH";
			case "geometry": return "GEOMETRY";
			case "vector": return options?.dimensions ? `VECTOR(${options.dimensions})` : "VECTOR";
			case "enum": return "TEXT";
			case "set": return "TEXT[]";
			case "arrayInt": return "INTEGER[]";
			case "arrayBigInt": return "BIGINT[]";
			case "arrayFloat": return "REAL[]";
			case "arrayDecimal":
				if (options?.precision !== void 0) {
					const scale = options.scale ?? 0;
					return `DECIMAL(${options.precision}, ${scale})[]`;
				}
				return "DECIMAL[]";
			case "arrayBoolean": return "BOOLEAN[]";
			case "arrayText": return "TEXT[]";
			case "arrayDate": return "DATE[]";
			case "arrayTimestamp": return "TIMESTAMPTZ[]";
			case "arrayUuid": return "UUID[]";
			case "arrayJson": return "JSONB[]";
			default: return type.toUpperCase();
		}
	}
	/**
	* Translate a database-agnostic aggregate expression to PostgreSQL SQL.
	*
	* The five scalar aggregates map to their ANSI SQL function. `distinct`,
	* `floor`, `first` and `last` are MongoDB-only for v1 — none has a
	* single-scalar `GROUP BY` equivalent on PostgreSQL, so they throw instead
	* of emitting a silently-different semantic (the footgun this guards).
	*
	* @param expression - The abstract aggregate (`$agg.*`) to translate
	* @returns The SQL fragment (e.g. `SUM("amount")`, `COUNT(*)`)
	*/
	aggregateToSql(expression) {
		const column = expression.__field === null ? "*" : this.quoteIdentifier(expression.__field);
		switch (expression.__agg) {
			case "count": return "COUNT(*)";
			case "sum": return `SUM(${column})`;
			case "avg": return `AVG(${column})`;
			case "min": return `MIN(${column})`;
			case "max": return `MAX(${column})`;
			default: throw new Error(`$agg.${expression.__agg} is MongoDB-only and not supported on a PostgreSQL groupBy. Use selectRaw / havingRaw with the equivalent SQL (window function / DISTINCT / FLOOR) if you need it here.`);
		}
	}
};
//#endregion
export { PostgresDialect };

//# sourceMappingURL=postgres-dialect.mjs.map