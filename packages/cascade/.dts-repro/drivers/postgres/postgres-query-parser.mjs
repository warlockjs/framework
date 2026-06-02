import { PostgresDialect } from "./postgres-dialect.mjs";
//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.ts
/**
* PostgreSQL Query Parser.
*
* Converts a list of query operations into a SQL query string with parameters.
* Handles SELECT, WHERE, JOIN, ORDER BY, GROUP BY, LIMIT/OFFSET clauses.
*
* @example
* ```typescript
* const parser = new PostgresQueryParser({
*   table: 'users',
*   operations: [
*     { type: 'where', data: { field: 'name', operator: '=', value: 'Alice' } },
*     { type: 'orderBy', data: { field: 'createdAt', direction: 'desc' } },
*     { type: 'limit', data: { value: 10 } }
*   ]
* });
*
* const { sql, params } = parser.parse();
* // sql: 'SELECT * FROM "users" WHERE "name" = $1 ORDER BY "createdAt" DESC LIMIT 10'
* // params: ['Alice']
* ```
*/
var PostgresQueryParser = class PostgresQueryParser {
	/**
	* Target table name.
	*/
	table;
	/**
	* Table alias.
	*/
	alias;
	/**
	* Operations to process.
	*/
	operations;
	/**
	* SQL dialect for syntax.
	*/
	dialect;
	/**
	* Current parameter index (1-based for PostgreSQL).
	*/
	paramIndex = 1;
	/**
	* Collected parameters.
	*/
	params = [];
	/**
	* SELECT columns.
	*/
	selectColumns = [];
	/**
	* Deselected (excluded) columns.
	*/
	deselectColumns = [];
	/**
	* Raw SELECT expressions.
	*/
	selectRaw = [];
	/**
	* WHERE clauses.
	*/
	whereClauses = [];
	/**
	* JOIN clauses.
	*/
	joinClauses = [];
	/**
	* ORDER BY clauses.
	*/
	orderClauses = [];
	/**
	* GROUP BY columns.
	*/
	groupColumns = [];
	/**
	* HAVING clauses.
	*/
	havingClauses = [];
	/**
	* LIMIT value.
	*/
	limitValue;
	/**
	* OFFSET value.
	*/
	offsetValue;
	/**
	* DISTINCT flag.
	*/
	isDistinct = false;
	/**
	* Whether the query has any JOIN operations (pre-scanned before processing).
	* Used by qualifyColumn() to decide whether to prefix columns with the main table.
	*/
	hasJoins = false;
	/**
	* Tracked joined tables (for table reference detection).
	*/
	joinedTables = /* @__PURE__ */ new Set();
	/**
	* Create a new query parser.
	*
	* @param options - Parser configuration
	*/
	constructor(options) {
		this.table = options.table;
		this.alias = options.alias;
		this.operations = options.operations;
		this.dialect = options.dialect ?? new PostgresDialect();
	}
	/**
	* Parse all operations and build the SQL query.
	*
	* @returns DriverQuery with `query` (SQL string) and `bindings` (parameter values)
	*/
	parse() {
		const JOIN_TYPES = new Set([
			"join",
			"leftJoin",
			"rightJoin",
			"innerJoin",
			"fullJoin",
			"crossJoin",
			"joinRaw"
		]);
		this.hasJoins = false;
		for (const operation of this.operations) if (JOIN_TYPES.has(operation.type)) {
			this.hasJoins = true;
			const data = operation.data;
			const joinTable = data.table;
			const alias = data.alias;
			if (joinTable) this.joinedTables.add(joinTable);
			if (alias) this.joinedTables.add(alias);
		}
		for (const operation of this.operations) this.processOperation(operation);
		return {
			query: this.buildSql(),
			bindings: this.params
		};
	}
	/**
	* Get a formatted string representation of the query.
	*
	* @returns Formatted SQL with bindings
	*/
	toPrettyString() {
		const { query = "", bindings } = this.parse();
		return `${query}\n-- Bindings: ${JSON.stringify(bindings ?? [])}`;
	}
	/**
	* Process a single operation.
	*
	* @param operation - The operation to process
	*/
	processOperation(operation) {
		const { type, data } = operation;
		switch (type) {
			case "where":
				this.processWhere(data, "AND");
				break;
			case "orWhere":
				this.processWhere(data, "OR");
				break;
			case "whereRaw":
				this.processWhereRaw(data, "AND");
				break;
			case "orWhereRaw":
				this.processWhereRaw(data, "OR");
				break;
			case "whereIn":
				this.processWhereIn(data, false);
				break;
			case "whereNotIn":
				this.processWhereIn(data, true);
				break;
			case "whereNull":
				this.processWhereNull(data, false);
				break;
			case "whereNotNull":
				this.processWhereNull(data, true);
				break;
			case "whereBetween":
				this.processWhereBetween(data, false);
				break;
			case "whereNotBetween":
				this.processWhereBetween(data, true);
				break;
			case "whereLike":
				this.processWhereLike(data, false);
				break;
			case "whereNotLike":
				this.processWhereLike(data, true);
				break;
			case "whereColumn":
				this.processWhereColumn(data, "AND");
				break;
			case "orWhereColumn":
				this.processWhereColumn(data, "OR");
				break;
			case "whereJsonContains":
				this.processWhereJsonContains(data, false);
				break;
			case "whereJsonDoesntContain":
				this.processWhereJsonContains(data, true);
				break;
			case "whereFullText":
				this.processWhereFullText(data);
				break;
			case "select":
				this.processSelect(data);
				break;
			case "selectRaw":
				this.processSelectRaw(data);
				break;
			case "deselect":
				this.processDeselect(data);
				break;
			case "join":
			case "innerJoin":
				this.processJoin(data, "INNER");
				break;
			case "leftJoin":
				this.processJoin(data, "LEFT");
				break;
			case "rightJoin":
				this.processJoin(data, "RIGHT");
				break;
			case "fullJoin":
				this.processJoin(data, "FULL OUTER");
				break;
			case "crossJoin":
				this.processCrossJoin(data);
				break;
			case "joinRaw":
				this.processJoinRaw(data);
				break;
			case "orderBy":
				this.processOrderBy(data);
				break;
			case "orderByRaw":
				this.processOrderByRaw(data);
				break;
			case "groupBy":
				this.processGroupBy(data);
				break;
			case "having":
				this.processHaving(data);
				break;
			case "havingRaw":
				this.processHavingRaw(data);
				break;
			case "limit":
				this.limitValue = data.value;
				break;
			case "offset":
				this.offsetValue = data.value;
				break;
			case "distinct":
				this.isDistinct = true;
				break;
			case "selectRelatedColumns":
				this.processSelectRelatedColumns(data);
				break;
			default: break;
		}
	}
	/**
	* Build the final SQL query from collected clauses.
	*
	* @returns Complete SQL query string
	*/
	buildSql() {
		const parts = [];
		parts.push(this.buildSelectClause());
		const quotedTable = this.dialect.quoteIdentifier(this.table);
		const fromClause = this.alias ? `FROM ${quotedTable} AS ${this.dialect.quoteIdentifier(this.alias)}` : `FROM ${quotedTable}`;
		parts.push(fromClause);
		if (this.joinClauses.length > 0) parts.push(this.joinClauses.join(" "));
		if (this.whereClauses.length > 0) parts.push(`WHERE ${this.whereClauses.join(" ")}`);
		if (this.groupColumns.length > 0) {
			const quotedCols = this.groupColumns.map((c) => this.dialect.quoteIdentifier(c));
			parts.push(`GROUP BY ${quotedCols.join(", ")}`);
		}
		if (this.havingClauses.length > 0) parts.push(`HAVING ${this.havingClauses.join(" AND ")}`);
		if (this.orderClauses.length > 0) parts.push(`ORDER BY ${this.orderClauses.join(", ")}`);
		const limitOffset = this.dialect.limitOffset(this.limitValue, this.offsetValue);
		if (limitOffset) parts.push(limitOffset);
		return parts.join(" ");
	}
	/**
	* Build the SELECT clause.
	*
	* @returns SELECT clause string
	*/
	buildSelectClause() {
		const distinct = this.isDistinct ? "DISTINCT " : "";
		if (this.selectColumns.length === 0 && this.selectRaw.length === 0) return this.hasJoins ? `SELECT ${distinct}${this.dialect.quoteIdentifier(this.table)}.*` : `SELECT ${distinct}*`;
		const columns = [];
		for (const col of this.selectColumns) if (!this.deselectColumns.includes(col)) columns.push(this.parseColumnIdentifier(col, this.table, this.alias));
		columns.push(...this.selectRaw);
		return `SELECT ${distinct}${columns.join(", ")}`;
	}
	/**
	* Add a placeholder and parameter.
	*
	* @param value - Parameter value
	* @returns Placeholder string ($1, $2, etc.)
	*/
	addParam(value) {
		this.params.push(value);
		return this.dialect.placeholder(this.paramIndex++);
	}
	/**
	* Absorb a sub-parser's params into this parser, returning a rewriter
	* function that translates the sub-parser's `$N` placeholders into freshly
	* numbered placeholders in this parser's namespace.
	*
	* Required whenever sub-parser SQL fragments (e.g. WHERE clauses produced
	* for a `joinWith` constraint) are spliced into the outer query — without
	* the rewrite the embedded `$N` references point at parameters this
	* parser has no knowledge of, leaving them dangling in the final SQL.
	*
	* The sub-parser's `params[i]` corresponds to its `$(i+1)` placeholder
	* (its `paramIndex` always starts at 1), so we map sequentially.
	*
	* @example
	*   const renumber = this.absorbSubParserParams(subParser);
	*   const fragment = renumber(subParser.whereClauses.join(" "));
	*/
	absorbSubParserParams(subParser) {
		if (subParser.params.length === 0) return (sql) => sql;
		const oldToNew = /* @__PURE__ */ new Map();
		for (let index = 0; index < subParser.params.length; index++) {
			const newPlaceholder = this.addParam(subParser.params[index]);
			oldToNew.set(`$${index + 1}`, newPlaceholder);
		}
		return (sql) => sql.replace(/\$\d+/g, (match) => oldToNew.get(match) ?? match);
	}
	/**
	* Process a basic WHERE operation.
	*
	* Delegates to specialised processors for operators that require more than a
	* single placeholder (between, in, like-variants, exists, etc.).
	*/
	processWhere(data, boolean) {
		const field = data.field;
		const operator = data.operator ?? "=";
		const value = data.value;
		switch (operator) {
			case "between": return this.processWhereBetween({
				field,
				range: value
			}, false);
			case "notBetween": return this.processWhereBetween({
				field,
				range: value
			}, true);
			case "in": return this.processWhereIn({
				field,
				values: value
			}, false);
			case "notIn": return this.processWhereIn({
				field,
				values: value
			}, true);
			case "like":
			case "ilike":
			case "startsWith":
			case "endsWith": return this.processWhereLike({
				field,
				pattern: value
			}, false);
			case "notLike":
			case "notStartsWith":
			case "notEndsWith": return this.processWhereLike({
				field,
				pattern: value
			}, true);
			case "exists": return this.addWhereClause(`EXISTS (${value})`, boolean);
		}
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		if (value === null) {
			const nullOperator = operator === "!=" ? "IS NOT NULL" : "IS NULL";
			return this.addWhereClause(`${quotedField} ${nullOperator}`, boolean);
		}
		const placeholder = this.addParam(value);
		this.addWhereClause(`${quotedField} ${this.mapOperator(operator)} ${placeholder}`, boolean);
	}
	/**
	* Process a raw WHERE operation.
	*/
	processWhereRaw(data, boolean) {
		const expression = data.expression;
		const bindings = data.bindings ?? [];
		let processed = expression;
		for (const binding of bindings) processed = processed.replace("?", this.addParam(binding));
		this.addWhereClause(processed, boolean);
	}
	/**
	* Process WHERE IN / NOT IN.
	*/
	processWhereIn(data, negate) {
		const field = data.field;
		const values = data.values;
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		const operator = negate ? "!= ALL" : "= ANY";
		const placeholder = this.addParam(values);
		this.addWhereClause(`${quotedField} ${operator}(${placeholder})`, "AND");
	}
	/**
	* Process WHERE NULL / NOT NULL.
	*/
	processWhereNull(data, negate) {
		const field = data.field;
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		const clause = negate ? `${quotedField} IS NOT NULL` : `${quotedField} IS NULL`;
		this.addWhereClause(clause, "AND");
	}
	/**
	* Process WHERE BETWEEN / NOT BETWEEN.
	*/
	processWhereBetween(data, negate) {
		const field = data.field;
		const range = data.range;
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		const placeholder1 = this.addParam(range[0]);
		const placeholder2 = this.addParam(range[1]);
		const keyword = negate ? "NOT BETWEEN" : "BETWEEN";
		this.addWhereClause(`${quotedField} ${keyword} ${placeholder1} AND ${placeholder2}`, "AND");
	}
	/**
	* Process WHERE LIKE / NOT LIKE.
	*/
	processWhereLike(data, negate) {
		const field = data.field;
		const pattern = data.pattern;
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		const { operator } = this.dialect.likePattern(pattern, true);
		const placeholder = this.addParam(pattern);
		const keyword = negate ? `NOT ${operator}` : operator;
		this.addWhereClause(`${quotedField} ${keyword} ${placeholder}`, "AND");
	}
	/**
	* Process WHERE column comparison.
	*/
	processWhereColumn(data, boolean) {
		const first = data.first;
		const operator = data.operator ?? "=";
		const second = data.second;
		const quotedFirst = this.parseColumnIdentifier(first, this.table, this.alias);
		const quotedSecond = this.parseColumnIdentifier(second, this.table, this.alias);
		this.addWhereClause(`${quotedFirst} ${operator} ${quotedSecond}`, boolean);
	}
	/**
	* Process WHERE JSON contains.
	*/
	processWhereJsonContains(data, negate) {
		const path = data.path;
		const value = data.value;
		const quotedPath = this.parseColumnIdentifier(path, this.table, this.alias);
		const jsonValue = JSON.stringify(value);
		const operator = negate ? "NOT @>" : "@>";
		this.addWhereClause(`${quotedPath} ${operator} '${jsonValue}'::jsonb`, "AND");
	}
	/**
	* Process full-text search WHERE.
	*/
	processWhereFullText(data) {
		const fields = data.fields;
		const query = data.query;
		const tsVectors = fields.map((f) => `to_tsvector('english', ${this.dialect.quoteIdentifier(f)})`).join(" || ");
		const placeholder = this.addParam(query);
		this.addWhereClause(`(${tsVectors}) @@ plainto_tsquery('english', ${placeholder})`, "AND");
	}
	/**
	* Process SELECT operation.
	*/
	processSelect(data) {
		const fields = data.fields;
		if (Array.isArray(fields)) this.selectColumns.push(...fields);
		else for (const [field, alias] of Object.entries(fields)) {
			const quotedField = this.dialect.quoteIdentifier(field);
			const quotedAlias = this.dialect.quoteIdentifier(alias);
			this.selectRaw.push(`${quotedField} AS ${quotedAlias}`);
		}
	}
	/**
	* Process raw SELECT expression.
	*/
	processSelectRaw(data) {
		const expression = data.expression;
		const bindings = data.bindings ?? [];
		if (typeof expression === "string") {
			let processed = expression;
			for (const binding of bindings) processed = processed.replace("?", this.addParam(binding));
			this.selectRaw.push(processed);
		} else for (const [alias, expr] of Object.entries(expression)) this.selectRaw.push(`${expr} AS ${this.dialect.quoteIdentifier(alias)}`);
	}
	/**
	* Process DESELECT operation.
	*/
	processDeselect(data) {
		const fields = data.fields;
		this.deselectColumns.push(...fields);
	}
	/**
	* Process SELECT for related columns (joinWith).
	*
	* - hasOne / belongsTo  → LEFT JOIN + row_to_json  (single object)
	* - hasMany             → correlated subquery with json_agg (array, no row explosion)
	*
	* @example hasMany correlated subquery:
	*   (SELECT json_agg(row_to_json(a.*))
	*    FROM "chat_message_actions" a
	*    WHERE a."chat_message_id" = "chat_messages"."id") AS "actions"
	*
	* @example hasOne/belongsTo row_to_json:
	*   row_to_json("organizationAiModel".*) AS "organizationAiModel"
	*/
	processSelectRelatedColumns(data) {
		const alias = data.alias;
		const select = data.select;
		const relationType = data.type;
		const constraintOps = data.constraintOps;
		const quotedAlias = this.dialect.quoteIdentifier(alias);
		const quotedTable = this.dialect.quoteIdentifier(this.table);
		if (!(this.selectColumns.length > 0) && !this.selectRaw.includes(`${quotedTable}.*`)) this.selectRaw.unshift(`${quotedTable}.*`);
		if (relationType === "hasMany") {
			const relatedTable = data.table;
			const foreignKey = data.foreignKey;
			const localKey = data.localKey;
			const quotedRelatedTable = this.dialect.quoteIdentifier(relatedTable);
			const quotedForeignKey = this.dialect.quoteIdentifier(foreignKey);
			const quotedLocalKey = this.dialect.quoteIdentifier(localKey);
			const quotedMainTable = this.dialect.quoteIdentifier(this.table);
			let innerSelect;
			if (select && select.length > 0) innerSelect = `json_agg(json_build_object(${select.map((col) => `'${col}', a.${this.dialect.quoteIdentifier(col)}`).join(", ")}))`;
			else innerSelect = `json_agg(row_to_json(a.*))`;
			const fkCondition = `a.${quotedForeignKey} = ${quotedMainTable}.${quotedLocalKey}`;
			let extraWhere = "";
			let orderBy = "";
			let limitClause = "";
			if (constraintOps && constraintOps.length > 0) {
				const subParser = new PostgresQueryParser({
					table: relatedTable,
					alias: "a",
					operations: constraintOps
				});
				subParser.parse();
				const renumber = this.absorbSubParserParams(subParser);
				if (subParser.whereClauses.length > 0) extraWhere = ` AND ${renumber(subParser.whereClauses.join(" "))}`;
				if (subParser.orderClauses.length > 0) orderBy = ` ORDER BY ${renumber(subParser.orderClauses.join(", "))}`;
				if (subParser.limitValue !== void 0) limitClause = ` LIMIT ${subParser.limitValue}`;
			}
			orderBy || limitClause ? `${quotedRelatedTable}${fkCondition}${extraWhere}${orderBy}${limitClause}` : `${innerSelect.replace("json_agg(", "").replace(/\)$/, "")}${quotedRelatedTable}${fkCondition}${extraWhere}`;
			const aggregated = orderBy || limitClause ? `(SELECT json_agg(row_to_json(sub.*)) FROM (SELECT * FROM ${quotedRelatedTable} a WHERE ${fkCondition}${extraWhere}${orderBy}${limitClause}) sub) AS ${quotedAlias}` : `(SELECT ${innerSelect} FROM ${quotedRelatedTable} a WHERE ${fkCondition}${extraWhere}) AS ${quotedAlias}`;
			this.selectRaw.push(aggregated);
		} else {
			let effectiveSelect = select;
			if (constraintOps && constraintOps.length > 0) {
				const subParser = new PostgresQueryParser({
					table: data.table ?? alias,
					alias,
					operations: constraintOps
				});
				subParser.parse();
				if (subParser.selectColumns.length > 0) effectiveSelect = subParser.selectColumns;
			}
			if (effectiveSelect && effectiveSelect.length > 0) {
				const selectedColumns = effectiveSelect.map((col) => `${quotedAlias}.${this.dialect.quoteIdentifier(col)}`).join(", ");
				this.selectRaw.push(`row_to_json((SELECT d FROM (SELECT ${selectedColumns}) d)) AS ${quotedAlias}`);
			} else this.selectRaw.push(`row_to_json(${quotedAlias}.*) AS ${quotedAlias}`);
		}
	}
	/**
	* Process JOIN operation with smart field detection.
	*
	* Handles both regular columns and JSONB nested paths:
	* - "id" → "table"."id" (auto-prefixed)
	* - "users.id" → "users"."id" (explicit table)
	* - "createdBy.id" → "table"."createdBy"->>'id' (JSONB path)
	* - "posts.createdBy.id" → "posts"."createdBy"->>'id' (JSONB with table)
	*/
	processJoin(data, type) {
		const options = data;
		const joinTable = "table" in options ? options.table : "";
		const localField = "localField" in options ? options.localField : "";
		const foreignField = "foreignField" in options ? options.foreignField : "";
		const alias = "alias" in options ? options.alias : void 0;
		const constraintOps = data.constraintOps ?? [];
		const quotedTable = this.dialect.quoteIdentifier(joinTable);
		const tableRef = alias ? `${quotedTable} AS ${this.dialect.quoteIdentifier(alias)}` : quotedTable;
		const tableAlias = alias ?? joinTable;
		this.joinedTables.add(joinTable);
		if (alias) this.joinedTables.add(alias);
		let onClause = `${this.parseColumnIdentifier(localField, this.table, this.alias)} = ${this.parseColumnIdentifier(foreignField, joinTable, tableAlias)}`;
		if (constraintOps.length > 0) {
			const whereOps = constraintOps.filter((op) => op.type.startsWith("where") || op.type.startsWith("orWhere"));
			if (whereOps.length > 0) {
				const subParser = new PostgresQueryParser({
					table: joinTable,
					alias: tableAlias,
					operations: whereOps
				});
				subParser.parse();
				if (subParser.whereClauses.length > 0) {
					const renumber = this.absorbSubParserParams(subParser);
					onClause = `${onClause} AND ${renumber(subParser.whereClauses.join(" "))}`;
				}
			}
		}
		this.joinClauses.push(`${type} JOIN ${tableRef} ON ${onClause}`);
	}
	/**
	* Parse a column identifier with smart detection for table prefixes and JSONB paths.
	*
	* Supports an optional explicit cast suffix using PostgreSQL's `::type` syntax,
	* which is the only way to coerce a JSONB-extracted value (always returned as
	* `text`) into another type. The parser does NOT infer casts from key names —
	* coercion is always opt-in by the caller.
	*
	* @param field - The field string. Examples:
	*   - "id"                       → `"table"."id"`
	*   - "users.id"                 → `"users"."id"`
	*   - "createdBy.id"             → `"table"."createdBy"->>'id'`
	*   - "createdBy.id::int"        → `("table"."createdBy"->>'id')::int`
	*   - "meta.score::numeric"      → `("table"."meta"->>'score')::numeric`
	*   - "posts.createdBy.id::uuid" → `("posts"."createdBy"->>'id')::uuid`
	* @param defaultTable - Default table to use if no prefix
	* @param tableAlias - Table alias to use if provided
	* @returns Properly quoted SQL expression
	*/
	parseColumnIdentifier(field, defaultTable, tableAlias) {
		if (!field) return "";
		let cast;
		const castIndex = field.indexOf("::");
		if (castIndex !== -1) {
			cast = field.slice(castIndex + 2).trim();
			field = field.slice(0, castIndex);
		}
		const effectiveTable = tableAlias ?? defaultTable;
		const parts = field.split(".");
		let expression;
		if (parts.length === 1) expression = `${this.dialect.quoteIdentifier(effectiveTable)}.${this.dialect.quoteIdentifier(field)}`;
		else if (parts.length === 2) {
			const [first, second] = parts;
			if (this.isTableReference(first)) expression = `${this.dialect.quoteIdentifier(first)}.${this.dialect.quoteIdentifier(second)}`;
			else expression = this.buildJsonbPath(effectiveTable, first, [second]);
		} else {
			const [first, second, ...rest] = parts;
			if (this.isTableReference(first)) expression = this.buildJsonbPath(first, second, rest);
			else expression = this.buildJsonbPath(effectiveTable, first, [second, ...rest]);
		}
		return cast ? `(${expression})::${cast}` : expression;
	}
	/**
	* Check if a string is a table reference (main table or join table).
	*/
	isTableReference(name) {
		if (name === this.table || name === this.alias) return true;
		if (this.joinedTables.has(name)) return true;
		return false;
	}
	/**
	* Build a JSONB path expression.
	*
	* @param table - Table name
	* @param column - JSONB column name
	* @param path - Array of nested keys
	* @returns PostgreSQL JSONB path expression
	*
	* Returns the raw JSONB path expression — extracted values are always `text`
	* (`->>` returns text). Callers that need a different type must request an
	* explicit cast via the `::type` suffix in `parseColumnIdentifier`.
	*
	* @example
	* buildJsonbPath("posts", "createdBy", ["id"])
	* // Returns: "posts"."createdBy"->>'id'
	*
	* buildJsonbPath("posts", "createdBy", ["address", "city"])
	* // Returns: "posts"."createdBy"->'address'->>'city'
	*/
	buildJsonbPath(table, column, path) {
		const quotedTable = this.dialect.quoteIdentifier(table);
		const quotedColumn = this.dialect.quoteIdentifier(column);
		if (path.length === 0) return `${quotedTable}.${quotedColumn}`;
		let expression = `${quotedTable}.${quotedColumn}`;
		for (let i = 0; i < path.length; i++) {
			const operator = i === path.length - 1 ? "->>" : "->";
			expression += `${operator}'${path[i]}'`;
		}
		return expression;
	}
	/**
	* Process CROSS JOIN operation.
	*/
	processCrossJoin(data) {
		const table = data.table;
		const quotedTable = this.dialect.quoteIdentifier(table);
		this.joinClauses.push(`CROSS JOIN ${quotedTable}`);
	}
	/**
	* Process raw JOIN expression.
	*/
	processJoinRaw(data) {
		const expression = data.expression;
		const bindings = data.bindings ?? [];
		let processed = expression;
		for (const binding of bindings) processed = processed.replace("?", this.addParam(binding));
		this.joinClauses.push(processed);
	}
	/**
	* Process ORDER BY operation.
	*/
	processOrderBy(data) {
		const field = data.field;
		const direction = (data.direction ?? "asc").toUpperCase();
		const quotedField = this.parseColumnIdentifier(field, this.table, this.alias);
		this.orderClauses.push(`${quotedField} ${direction}`);
	}
	/**
	* Process raw ORDER BY expression.
	*/
	processOrderByRaw(data) {
		const expression = data.expression;
		const bindings = data.bindings ?? [];
		let processed = expression;
		for (const binding of bindings) processed = processed.replace("?", this.addParam(binding));
		this.orderClauses.push(processed);
	}
	/**
	* Process GROUP BY operation.
	*/
	processGroupBy(data) {
		const fields = data.fields;
		const columns = Array.isArray(fields) ? fields : [fields];
		this.groupColumns.push(...columns);
	}
	/**
	* Process HAVING operation.
	*/
	processHaving(data) {
		const field = data.field;
		const operator = data.operator ?? "=";
		const value = data.value;
		const quotedField = this.dialect.quoteIdentifier(field);
		const placeholder = this.addParam(value);
		this.havingClauses.push(`${quotedField} ${operator} ${placeholder}`);
	}
	/**
	* Process a raw HAVING expression, threading `?` placeholders into
	* positional params the same way `processWhereRaw` / `processSelectRaw` do.
	* Without this, bindings on a `havingRaw` op are silently dropped.
	*/
	processHavingRaw(data) {
		let expression = data.expression;
		const bindings = data.bindings ?? [];
		for (const binding of bindings) expression = expression.replace("?", this.addParam(binding));
		this.havingClauses.push(expression);
	}
	/**
	* Add a WHERE clause with boolean operator.
	*/
	addWhereClause(clause, boolean) {
		if (this.whereClauses.length === 0) this.whereClauses.push(clause);
		else this.whereClauses.push(`${boolean} ${clause}`);
	}
	/**
	* Map simple Cascade operators to their SQL equivalents.
	*
	* Complex operators (between, in, like-variants, exists) are handled by
	* dedicated processors and should never reach this method.
	*/
	mapOperator(operator) {
		return {
			"=": "=",
			"!=": "!=",
			"<>": "<>",
			">": ">",
			">=": ">=",
			"<": "<",
			"<=": "<=",
			like: "LIKE",
			notlike: "NOT LIKE",
			ilike: "ILIKE"
		}[operator.toLowerCase()] ?? operator;
	}
};
//#endregion
export { PostgresQueryParser };

//# sourceMappingURL=postgres-query-parser.mjs.map