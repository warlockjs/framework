import { dataSourceRegistry } from "../../data-source/data-source-registry.mjs";
import { resolveModelClass, tryResolveModelClass } from "../../model/register-model.mjs";
import { inferBelongsToForeignKey, inferHasForeignKey, inferPivotKey, inferPivotTable } from "../../relations/key-conventions.mjs";
import { RelationLoader, attachLoadedRelation } from "../../relations/relation-loader.mjs";
import { isAggregateExpression } from "../../expressions/aggregate-expressions.mjs";
import { QueryBuilder } from "../../query-builder/query-builder.mjs";
import { PostgresQueryParser } from "./postgres-query-parser.mjs";
//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts
/**
* Cast an Op[] to PostgresParserOperation[] — the shapes are compatible since
* both have `type: string` and `data: Record<string, unknown>`.
*/
function toParserOps(ops) {
	return ops;
}
/**
* PostgreSQL Query Builder.
*
* Collects query operations (via the base class) and delegates SQL generation
* to `PostgresQueryParser`. Owns execution, hydration, and relation loading.
*
* @example
* ```typescript
* const users = await User.query()
*   .select(["id", "name", "email"])
*   .where("status", "active")
*   .orderBy("createdAt", "desc")
*   .limit(10)
*   .get();
* ```
*/
var PostgresQueryBuilder = class PostgresQueryBuilder extends QueryBuilder {
	table;
	/** Data source backing this builder. */
	dataSource;
	/** Hydration callback for transforming result rows into model instances. */
	hydrateCallback;
	/** Invoked before query execution. */
	fetchingCallback;
	/** Invoked after fetch but before hydration. */
	hydratingCallback;
	/** Invoked after fetch and hydration. */
	fetchedCallback;
	/**
	* Map of relations registered via `joinWith()`.
	* Keyed by dot-notation path (e.g. "organizationAiModel.aiModel").
	*/
	joinRelations = /* @__PURE__ */ new Map();
	/**
	* Idempotency guard for `applyJoinRelations()` so calling `parse()` then
	* `get()` (or `parse()` twice) doesn't double-emit `selectRelatedColumns`
	* operations.
	*/
	joinRelationsApplied = false;
	/**
	* Idempotency guard for `applyCountRelations()` — see `joinRelationsApplied`.
	*/
	countRelationsApplied = false;
	/**
	* Idempotency guard for `applyHasRelations()` — see `joinRelationsApplied`.
	*/
	hasRelationsApplied = false;
	/**
	* Alias → SQL expression for two-arg `groupBy` aggregates. Recorded by the
	* `groupBy` override; consumed by `applyGroupByAggregates` to rewrite a
	* `having()` on the alias into the underlying expression (Postgres forbids
	* SELECT aliases in HAVING).
	*/
	aggregateAliases = /* @__PURE__ */ new Map();
	/**
	* Idempotency guard for `applyGroupByAggregates()` — see `joinRelationsApplied`.
	*/
	groupByAggregatesApplied = false;
	/**
	* @param table - Target table name
	* @param dataSource - Optional (uses default data source from registry if omitted)
	*/
	constructor(table, dataSource) {
		super();
		this.table = table;
		this.dataSource = dataSource ?? dataSourceRegistry.get();
	}
	get driver() {
		return this.dataSource.driver;
	}
	clone() {
		const cloned = new PostgresQueryBuilder(this.table, this.dataSource);
		cloned.operations = [...this.operations];
		cloned.pendingGlobalScopes = this.pendingGlobalScopes;
		cloned.availableLocalScopes = this.availableLocalScopes;
		cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
		cloned.scopesApplied = this.scopesApplied;
		cloned.eagerLoadRelations = new Map(this.eagerLoadRelations);
		cloned.countRelations = new Map(this.countRelations);
		cloned.relationDefinitions = this.relationDefinitions;
		cloned.modelClass = this.modelClass;
		cloned.hydrateCallback = this.hydrateCallback;
		cloned.joinRelations = new Map(this.joinRelations);
		cloned.joinRelationsApplied = this.joinRelationsApplied;
		cloned.countRelationsApplied = this.countRelationsApplied;
		cloned.hasRelationsApplied = this.hasRelationsApplied;
		cloned.aggregateAliases = new Map(this.aggregateAliases);
		cloned.groupByAggregatesApplied = this.groupByAggregatesApplied;
		return cloned;
	}
	/**
	* Native-query escape hatch. Passes `operations[]` to the callback for
	* direct manipulation. Use sparingly — only when fluent API is insufficient.
	*
	* @example
	* q.raw(ops => ops.push({ type: "whereRaw", data: { expression: "1=1" } }))
	*/
	raw(callback) {
		callback(this.operations);
		return this;
	}
	/**
	* Record a DISTINCT flag AND auto-select the field(s).
	* In PostgreSQL, DISTINCT ON (col) requires the col to appear in SELECT.
	*
	* @example
	* q.distinctValues("category")               // SELECT category … DISTINCT ON (category)
	* q.distinctValues(["category", "status"])   // both fields in DISTINCT ON and SELECT
	*/
	distinctValues(fields) {
		super.distinctValues(fields);
		if (fields) {
			const fieldArr = Array.isArray(fields) ? fields : [fields];
			this.addOperation("select", { fields: fieldArr });
		}
		return this;
	}
	groupBy(fields, aggregates) {
		if (!aggregates) return super.groupBy(fields);
		const fieldList = Array.isArray(fields) ? fields : [fields];
		this.addOperation("select", { fields: fieldList });
		for (const [alias, expression] of Object.entries(aggregates)) {
			let sql;
			if (isAggregateExpression(expression)) sql = this.driver.dialect.aggregateToSql(expression);
			else if (typeof expression === "string") sql = expression;
			else throw new Error(`groupBy aggregate "${alias}" must be a $agg.* helper or a raw SQL string on Postgres; got ${typeof expression}. MongoDB operator objects are not portable to SQL — use selectRaw with explicit SQL.`);
			this.aggregateAliases.set(alias, sql);
			this.addOperation("selectRaw", {
				expression: `${sql} AS ${this.driver.dialect.quoteIdentifier(alias)}`,
				bindings: []
			});
		}
		return super.groupBy(fields);
	}
	/**
	* Nearest-neighbour vector similarity search via pgvector cosine distance.
	*
	* Adds two operations atomically:
	* 1. `selectRaw` → `1 - (column <=> $n::vector) AS <alias>`
	*    Makes the similarity score available on every returned row.
	* 2. `orderByRaw` → `column <=> $n::vector`
	*    Tells the PostgreSQL query planner to use the IVFFlat/HNSW vector index.
	*    Using the alias in ORDER BY would bypass the index — the raw expression is required.
	*
	* @example
	* ```typescript
	* const results = await Vector.query()
	*   .where({ organization_id: "org-123", content_type: "summary" })
	*   .similarTo("embedding", queryEmbedding)
	*   .limit(5)
	*   .get<VectorRow & { score: number }>();
	* ```
	*/
	similarTo(column, embedding, alias = "score") {
		const literal = `[${embedding.join(",")}]`;
		const quotedCol = this.driver.dialect.quoteIdentifier(column);
		const quotedTable = this.driver.dialect.quoteIdentifier(this.table);
		this.addOperation("selectRaw", {
			expression: `${quotedTable}.*`,
			bindings: []
		});
		this.addOperation("selectRaw", {
			expression: `1 - (${quotedCol} <=> ?::vector) AS ${alias}`,
			bindings: [literal]
		});
		this.addOperation("orderByRaw", {
			expression: `${quotedCol} <=> ?::vector`,
			bindings: [literal]
		});
		return this;
	}
	/** Set a hydration callback that transforms each result row. */
	hydrate(callback) {
		this.hydrateCallback = callback;
		return this;
	}
	/** Register a callback invoked before query execution. */
	onFetching(callback) {
		this.fetchingCallback = callback;
		return () => {
			this.fetchingCallback = void 0;
		};
	}
	/** Register a callback invoked after fetch but before hydration. */
	onHydrating(callback) {
		this.hydratingCallback = callback;
		return () => {
			this.hydratingCallback = void 0;
		};
	}
	/** Register a callback invoked after fetch and hydration. */
	onFetched(callback) {
		this.fetchedCallback = callback;
		return () => {
			this.fetchedCallback = void 0;
		};
	}
	/** Apply pending global scopes to the operations list. */
	applyPendingScopes() {
		if (!this.pendingGlobalScopes || this.scopesApplied) return;
		const beforeOps = [];
		const afterOps = [];
		for (const [name, { callback, timing }] of this.pendingGlobalScopes) {
			if (this.disabledGlobalScopes.has(name)) continue;
			const temp = new PostgresQueryBuilder(this.table, this.dataSource);
			callback(temp);
			if (timing === "before") beforeOps.push(...temp.operations);
			else afterOps.push(...temp.operations);
		}
		this.operations = [
			...beforeOps,
			...this.operations,
			...afterOps
		];
		this.scopesApplied = true;
	}
	/** Array field contains a value (or object with key). */
	whereArrayContains(field, value, key) {
		const quotedField = this.driver.dialect.quoteIdentifier(field);
		if (key) this.addOperation("whereRaw", {
			expression: `${quotedField} @> ?::jsonb`,
			bindings: [JSON.stringify([{ [key]: value }])]
		});
		else this.addOperation("whereRaw", {
			expression: `? = ANY(${quotedField})`,
			bindings: [value]
		});
		return this;
	}
	/** Array field does NOT contain a value (or object with key). */
	whereArrayNotContains(field, value, key) {
		const quotedField = this.driver.dialect.quoteIdentifier(field);
		if (key) this.addOperation("whereRaw", {
			expression: `NOT (${quotedField} @> ?::jsonb)`,
			bindings: [JSON.stringify([{ [key]: value }])]
		});
		else this.addOperation("whereRaw", {
			expression: `NOT (? = ANY(${quotedField}))`,
			bindings: [value]
		});
		return this;
	}
	/** Array field contains value OR is empty. */
	whereArrayHasOrEmpty(field, value, key) {
		const quotedField = this.driver.dialect.quoteIdentifier(field);
		if (key) this.addOperation("whereRaw", {
			expression: `(${quotedField} @> ?::jsonb OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
			bindings: [JSON.stringify([{ [key]: value }])]
		});
		else this.addOperation("whereRaw", {
			expression: `(? = ANY(${quotedField}) OR array_length(${quotedField}, 1) IS NULL)`,
			bindings: [value]
		});
		return this;
	}
	/** Array field does NOT contain value OR is empty. */
	whereArrayNotHaveOrEmpty(field, value, key) {
		const quotedField = this.driver.dialect.quoteIdentifier(field);
		if (key) this.addOperation("whereRaw", {
			expression: `(NOT (${quotedField} @> ?::jsonb) OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
			bindings: [JSON.stringify([{ [key]: value }])]
		});
		else this.addOperation("whereRaw", {
			expression: `(NOT (? = ANY(${quotedField})) OR array_length(${quotedField}, 1) IS NULL)`,
			bindings: [value]
		});
		return this;
	}
	/**
	* Load relations via SQL JOINs (single query) with optional per-relation constraints.
	*
	* Supports:
	* - `joinWith("author")` / `joinWith(["author", "category"])`
	* - `joinWith({ actions: q => q.where("status", "pending").limit(5) })`
	* - `joinWith({ organizationAiModel: "id,name", actions: q => q.orderBy("sort_order") })`
	*
	* @example
	* ChatMessage.joinWith({
	*   actions: q => q.where("status", "pending").orderBy("sort_order", "asc").limit(5),
	*   organizationAiModel: "id,createdAt",
	* })
	*/
	joinWith(...args) {
		const entries = [];
		for (const arg of args) if (typeof arg === "string") entries.push({ path: arg });
		else if (Array.isArray(arg)) for (const rel of arg) entries.push({ path: rel });
		else if (typeof arg === "object" && arg !== null) for (const [rel, val] of Object.entries(arg)) entries.push({
			path: rel,
			constraint: val
		});
		for (const { path, constraint } of entries) {
			const segments = path.split(".");
			let currentModel = this.modelClass;
			let currentPath = "";
			for (let i = 0; i < segments.length; i++) {
				const rawSeg = segments[i];
				const colonIdx = rawSeg.indexOf(":");
				const segName = colonIdx === -1 ? rawSeg : rawSeg.slice(0, colonIdx);
				const segColumns = colonIdx === -1 ? void 0 : rawSeg.slice(colonIdx + 1).split(",").filter(Boolean);
				currentPath = currentPath ? `${currentPath}.${segName}` : segName;
				if (this.joinRelations.has(currentPath)) {
					const existing = this.joinRelations.get(currentPath);
					if (segColumns) existing.select = segColumns;
					if (i === segments.length - 1 && constraint !== void 0) existing.constraintOps = this._resolveConstraintOps(constraint);
					currentModel = tryResolveModelClass(existing.model);
					continue;
				}
				if (!this.relationDefinitions) continue;
				const def = (i === 0 ? this.relationDefinitions : currentModel?.relations)?.[segName];
				if (!def) throw new Error(`Relation "${segName}" not found on model ${currentModel?.name ?? "unknown"}`);
				let selectColumns = segColumns ?? def.select;
				let constraintOps;
				if (i === segments.length - 1 && constraint !== void 0) if (typeof constraint === "string") selectColumns = constraint.split(",").filter(Boolean);
				else constraintOps = this._resolveConstraintOps(constraint);
				const alias = currentPath.replace(/\./g, "_");
				this.joinRelations.set(currentPath, {
					alias,
					type: def.type,
					model: def.model,
					localKey: def.localKey,
					foreignKey: def.foreignKey,
					ownerKey: def.ownerKey,
					parentPath: i > 0 ? currentPath.substring(0, currentPath.lastIndexOf(".")) : null,
					relationName: segName,
					parentModel: currentModel,
					select: selectColumns,
					constraintOps
				});
				currentModel = tryResolveModelClass(def.model);
				if (!currentModel) throw new Error(`Relation model not found for "${segName}" in "${currentPath}"`);
			}
		}
		return this;
	}
	/** Run a joinWith constraint callback against a sub-QB and capture its operations. */
	_resolveConstraintOps(constraint) {
		if (typeof constraint === "string") return [];
		const sub = new PostgresQueryBuilder("__sub__", this.dataSource);
		constraint(sub);
		return sub.operations;
	}
	/**
	* Execute the query and return all matching rows.
	*/
	async get() {
		this.applyPendingScopes();
		this._processJoinWithOps();
		this.applyJoinRelations();
		this.applyHasRelations();
		this.applyCountRelations();
		this.applyGroupByAggregates();
		if (this.fetchingCallback) await this.fetchingCallback(this);
		const { query = "", bindings = [] } = new PostgresQueryParser({
			table: this.table,
			operations: toParserOps(this.operations)
		}).parse();
		try {
			let records = (await this.driver.query(query, bindings)).rows;
			const joinedData = this.extractJoinedRelationData(records);
			if (this.hydratingCallback) await this.hydratingCallback(records, {});
			if (this.hydrateCallback) records = records.map((row, index) => this.hydrateCallback(row, index));
			this.attachJoinedRelations(records, joinedData);
			await this.applyEagerLoading(records);
			if (this.fetchedCallback) await this.fetchedCallback(records, {});
			this.operations = [];
			return records;
		} catch (error) {
			console.log("Error while executing:", query, bindings);
			console.log("Query Builder Error:", error);
			throw error;
		}
	}
	/** Get first result. */
	async first() {
		return (await this.limit(1).get())[0] ?? null;
	}
	/** Get last result (by id desc). */
	async last() {
		return (await this.orderByDesc("id").limit(1).get())[0] ?? null;
	}
	/** Get random results. */
	async random(limit) {
		this.orderByRaw("RANDOM()");
		if (limit) this.limit(limit);
		return this.get();
	}
	/** Get first or throw. */
	async firstOrFail() {
		const result = await this.first();
		if (!result) throw new Error("No records found");
		return result;
	}
	/** Get first or call callback. */
	async firstOr(callback) {
		return await this.first() ?? await callback();
	}
	/** Get first or return null. */
	async firstOrNull() {
		return this.first();
	}
	/** Get first or return default. */
	async firstOrNew(defaults) {
		return await this.first() ?? defaults;
	}
	/** Find by primary key. */
	async find(id) {
		return this.where("id", id).first();
	}
	/** Count matching rows. */
	async count() {
		this.applyPendingScopes();
		const countOps = toParserOps([...this.operations.filter((op) => op.type.includes("where") || op.type.includes("join")), {
			type: "selectRaw",
			data: { expression: "COUNT(*) AS \"count\"" }
		}]);
		const { query = "", bindings = [] } = new PostgresQueryParser({
			table: this.table,
			operations: countOps
		}).parse();
		const result = await this.driver.query(query, bindings);
		return parseInt(result.rows[0]?.count ?? "0", 10);
	}
	/** SUM a numeric field. */
	async sum(field) {
		this.applyPendingScopes();
		const result = await this.selectRaw(`SUM(${field}) as sum`).first();
		return parseFloat(result?.sum ?? "0");
	}
	/** AVG of a numeric field. */
	async avg(field) {
		this.applyPendingScopes();
		const result = await this.selectRaw(`AVG(${field}) as avg`).first();
		return parseFloat(result?.avg ?? "0");
	}
	/** MIN of a numeric field. */
	async min(field) {
		this.applyPendingScopes();
		const result = await this.selectRaw(`MIN(${field}) as min`).first();
		return parseFloat(result?.min ?? "0");
	}
	/** MAX of a numeric field. */
	async max(field) {
		this.applyPendingScopes();
		const result = await this.selectRaw(`MAX(${field}) as max`).first();
		return parseFloat(result?.max ?? "0");
	}
	/** Get distinct values for a field. */
	async distinct(field) {
		this.distinctValues(field);
		return (await this.get()).map((row) => row[field]);
	}
	/** Get array of all values for a single field. */
	async pluck(field) {
		return (await this.select([field]).get()).map((row) => row[field]);
	}
	/** Get a single scalar value. */
	async value(field) {
		return (await this.select([field]).first())?.[field] ?? null;
	}
	/** Check whether any matching rows exist. */
	async exists() {
		return await this.limit(1).count() > 0;
	}
	/** Check whether NO matching rows exist. */
	async notExists() {
		return !await this.exists();
	}
	/** COUNT DISTINCT a field. */
	async countDistinct(field) {
		const result = await this.selectRaw(`COUNT(DISTINCT ${field}) as count`).first();
		return parseInt(result?.count ?? "0", 10);
	}
	/** Get latest records ordered by a column. */
	async latest(column = "createdAt") {
		return this.orderBy(column, "desc").get();
	}
	/** Increment a numeric field. Returns new value. */
	async increment(field, amount = 1) {
		this.applyPendingScopes();
		const { sql: filterSql, params: filterParams } = this.buildFilter();
		const updateSql = `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + $1 ` + (filterSql ? `WHERE ${filterSql.replace("WHERE ", "")} ` : "") + `RETURNING ${this.driver.dialect.quoteIdentifier(field)}`;
		return (await this.driver.query(updateSql, [amount, ...filterParams])).rows[0]?.[field] ?? 0;
	}
	/** Decrement a numeric field. Returns new value. */
	async decrement(field, amount = 1) {
		return this.increment(field, -amount);
	}
	/** Increment a field for all matching rows. Returns affected row count. */
	async incrementMany(field, amount = 1) {
		this.applyPendingScopes();
		const { sql: filterSql, params: filterParams } = this.buildFilter();
		const updateSql = `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + $1` + (filterSql ? ` WHERE ${filterSql.replace("WHERE ", "")}` : "");
		return (await this.driver.query(updateSql, [amount, ...filterParams])).rowCount ?? 0;
	}
	/** Decrement a field for all matching rows. Returns affected row count. */
	async decrementMany(field, amount = 1) {
		return this.incrementMany(field, -amount);
	}
	/**
	* Process results in memory-efficient chunks.
	*
	* @example
	* await User.query().chunk(100, async (rows, idx) => { ... })
	*/
	async chunk(size, callback) {
		let chunkIndex = 0;
		let hasMore = true;
		while (hasMore) {
			const chunk = await this.clone().skip(chunkIndex * size).limit(size).get();
			if (chunk.length === 0) break;
			if (await callback(chunk, chunkIndex) === false) break;
			hasMore = chunk.length === size;
			chunkIndex++;
		}
	}
	/** Page-based pagination. */
	async paginate(options) {
		const page = options?.page ?? 1;
		const limit = options?.limit ?? 10;
		const skip = (page - 1) * limit;
		const [data, total] = await Promise.all([this.clone().skip(skip).limit(limit).get(), this.count()]);
		return {
			data,
			pagination: {
				total,
				page,
				limit,
				pages: Math.ceil(total / limit)
			}
		};
	}
	/**
	* Set cursor pagination hints fluently.
	* The recorded values are picked up by `cursorPaginate()` when no explicit
	* options are passed.
	*
	* @example
	* User.query().cursor(lastId).cursorPaginate({ limit: 20 })
	*/
	cursor(after, before) {
		this.addOperation("cursor", {
			after,
			before
		});
		return this;
	}
	/** Cursor-based pagination. */
	async cursorPaginate(options) {
		const recordedCursor = this.getOps("cursor")[0]?.data.after;
		const { limit = 10, cursor = recordedCursor, column = "id", direction = "next" } = options ?? {};
		if (cursor) this.where(column, direction === "next" ? ">" : "<", cursor);
		this.orderBy(column, direction === "next" ? "asc" : "desc");
		const results = await this.limit(limit + 1).get();
		const hasMore = results.length > limit;
		let data = hasMore ? results.slice(0, limit) : results;
		if (direction === "prev") data = data.reverse();
		let nextCursor;
		let prevCursor;
		let hasPrev = false;
		if (data.length > 0) {
			const firstItem = data[0][column];
			const lastItem = data[data.length - 1][column];
			if (direction === "next") {
				nextCursor = hasMore ? lastItem : void 0;
				if (cursor) {
					hasPrev = true;
					prevCursor = firstItem;
				}
			} else {
				prevCursor = hasMore ? firstItem : void 0;
				hasPrev = hasMore;
				if (cursor) nextCursor = lastItem;
			}
		}
		return {
			data,
			pagination: {
				hasMore,
				hasPrev,
				nextCursor,
				prevCursor
			}
		};
	}
	/** Delete matching rows. Returns deleted count. */
	async delete() {
		this.applyPendingScopes();
		const { sql, params } = this.buildFilter();
		const deleteSql = `DELETE FROM ${this.driver.dialect.quoteIdentifier(this.table)} ${sql}`;
		return (await this.driver.query(deleteSql, params)).rowCount ?? 0;
	}
	/** Delete the first matching row. */
	async deleteOne() {
		return this.limit(1).delete();
	}
	/** Update matching rows. */
	async update(fields) {
		this.applyPendingScopes();
		return (await this.driver.updateMany(this.table, {}, { $set: fields })).modifiedCount;
	}
	/** Unset fields from matching rows. */
	async unset(...fields) {
		this.applyPendingScopes();
		const updateObj = {};
		for (const field of fields) updateObj[field] = 1;
		return (await this.driver.updateMany(this.table, {}, { $unset: updateObj })).modifiedCount;
	}
	/**
	* Return the SQL + bindings without executing.
	*
	* Runs the same prelude as `get()` (scopes, joinWith expansion, joinRelations,
	* countRelations) so the preview matches what would actually be sent to the
	* database. The apply* methods are idempotent — calling `parse()` then `get()`
	* does not double-emit operations.
	*/
	parse() {
		this.applyPendingScopes();
		this._processJoinWithOps();
		this.applyJoinRelations();
		this.applyHasRelations();
		this.applyCountRelations();
		this.applyGroupByAggregates();
		return new PostgresQueryParser({
			table: this.table,
			operations: toParserOps(this.operations)
		}).parse();
	}
	/** Formatted SQL string (for logging/debugging). */
	pretty() {
		const { query = "", bindings } = this.parse();
		return `${query}\n-- Bindings: ${JSON.stringify(bindings ?? [])}`;
	}
	/** Run EXPLAIN ANALYZE on the query. */
	async explain() {
		const { query = "", bindings = [] } = this.parse();
		return (await this.driver.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, bindings)).rows;
	}
	/** Extend the builder with a driver-specific extension. */
	extend(extension, ..._args) {
		throw new Error(`Extension "${extension}" is not supported by PostgresQueryBuilder`);
	}
	/** Pluck scalar values for a single field (alias for pluck). */
	async pluckOne(field) {
		return (await this.select([field]).get()).map((row) => row[field]);
	}
	/**
	* Before `get()` runs the parser, consume any joinWith ops recorded by the base
	* class and expand them into the joinRelations Map.
	*/
	_processJoinWithOps() {
		const joinWithOps = this.operations.filter((op) => op.type === "joinWith");
		if (joinWithOps.length === 0) return;
		this.operations = this.operations.filter((op) => op.type !== "joinWith");
		for (const op of joinWithOps) {
			const constraints = op.data.constraints;
			for (const [path, constraint] of Object.entries(constraints)) if (!constraint || constraint === "") this.joinWith(path);
			else this.joinWith({ [path]: constraint });
		}
	}
	/**
	* Translate each entry in `joinRelations` into actual JOIN + selectRelatedColumns operations.
	*
	* Idempotent — guarded by `joinRelationsApplied` so repeat calls (e.g.
	* `parse()` followed by `get()`) don't double-emit operations.
	*/
	applyJoinRelations() {
		if (this.joinRelationsApplied || this.joinRelations.size === 0) return;
		this.joinRelationsApplied = true;
		for (const [path, config] of this.joinRelations) {
			const RelatedModel = tryResolveModelClass(config.model);
			if (!RelatedModel) throw new Error(`Relation model not found for ${path}`);
			const relatedTable = RelatedModel.table;
			const alias = config.alias;
			const parentTable = config.parentPath ? this.joinRelations.get(config.parentPath).alias : this.table;
			const parentModel = config.parentModel;
			const relatedModelMeta = RelatedModel;
			let localField;
			let foreignField;
			const conventions = this.dataSource?.relationDefaults;
			if (config.type === "belongsTo") {
				localField = config.foreignKey ?? inferBelongsToForeignKey(config.relationName ?? "", conventions);
				foreignField = config.ownerKey ?? relatedModelMeta.primaryKey ?? "id";
			} else {
				localField = config.localKey ?? parentModel?.primaryKey ?? "id";
				foreignField = config.foreignKey ?? inferHasForeignKey(parentModel?.name ?? "Model", conventions);
			}
			if (config.type !== "hasMany") this.addOperation("leftJoin", {
				table: relatedTable,
				alias,
				localField: `${parentTable}.${localField}`,
				foreignField,
				constraintOps: config.constraintOps
			});
			this.addOperation("selectRelatedColumns", {
				alias,
				relationName: config.relationName,
				path,
				table: relatedTable,
				select: config.select,
				type: config.type,
				foreignKey: foreignField,
				localKey: localField,
				parentTable,
				constraintOps: config.constraintOps
			});
		}
	}
	/**
	* Translate every `has` / `whereHas` / `orWhereHas` / `doesntHave` /
	* `whereDoesntHave` operation into an equivalent `whereRaw` (or
	* `orWhereRaw`) carrying an EXISTS / NOT EXISTS / COUNT-comparison
	* subquery. Keeps the parser pure (no schema awareness) — same pattern as
	* `applyJoinRelations` and `applyCountRelations`.
	*
	* In-place rewrite preserves position so the boolean (AND/OR) stays
	* correctly slotted relative to other where conditions.
	*
	* Idempotent — guarded by `hasRelationsApplied` so repeat calls (e.g.
	* `parse()` followed by `get()`) don't double-translate.
	*/
	applyHasRelations() {
		if (this.hasRelationsApplied) return;
		const HAS_OP_TYPES = new Set([
			"has",
			"whereHas",
			"orWhereHas",
			"doesntHave",
			"whereDoesntHave"
		]);
		if (!this.operations.some((op) => HAS_OP_TYPES.has(op.type))) {
			this.hasRelationsApplied = true;
			return;
		}
		this.hasRelationsApplied = true;
		this.operations = this.operations.map((op) => {
			if (!HAS_OP_TYPES.has(op.type)) return op;
			return this.translateHasOp(op);
		});
		this.rebuildIndex();
	}
	/**
	* Translate one has-family operation into its `whereRaw`/`orWhereRaw`
	* equivalent. Resolves the relation definition, builds the EXISTS or
	* COUNT-comparison subquery, and returns the replacement op.
	*/
	translateHasOp(op) {
		const data = op.data;
		const definition = this.relationDefinitions?.[data.relation];
		if (!definition) {
			const modelName = this.modelClass?.name ?? "unknown";
			throw new Error(`${op.type}: Relation "${data.relation}" not found on model ${modelName}`);
		}
		const RelatedModel = tryResolveModelClass(definition.model);
		if (!RelatedModel || !RelatedModel.table) throw new Error(`${op.type}: Related model not resolvable for "${data.relation}"`);
		const subquery = this.buildHasSubquery(op.type, data.relation, definition, RelatedModel, data.subquery, data.operator, data.count);
		return {
			type: op.type === "orWhereHas" ? "orWhereRaw" : "whereRaw",
			data: {
				expression: subquery.expression,
				bindings: subquery.bindings
			}
		};
	}
	/**
	* Build the SQL fragment that goes inside a `whereRaw` op for a has-family
	* translation. Branches on relation type AND on the operation type:
	*
	* - `has` with default operator/count → `EXISTS (SELECT 1 FROM ...)`
	* - `has` with custom operator/count → `(SELECT COUNT(*) FROM ...) <op> <count>`
	* - `whereHas` / `orWhereHas` → `EXISTS (SELECT 1 ... AND <constraint>)`
	* - `doesntHave` → `NOT EXISTS (SELECT 1 FROM ...)`
	* - `whereDoesntHave` → `NOT EXISTS (SELECT 1 ... AND <constraint>)`
	*/
	buildHasSubquery(opType, relationName, definition, RelatedModel, constraintOps, operator, count) {
		const dialect = this.driver.dialect;
		const quotedSelfTable = dialect.quoteIdentifier(this.table);
		const quotedRelatedTable = dialect.quoteIdentifier(RelatedModel.table);
		const relationType = definition.type;
		const selfModel = this.modelClass;
		const conventions = this.dataSource?.relationDefaults;
		const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);
		let fromClause;
		let joinCondition;
		if (relationType === "hasMany" || relationType === "hasOne") {
			const localKey = definition.localKey ?? selfModel?.primaryKey ?? "id";
			const foreignKey = definition.foreignKey ?? inferHasForeignKey(selfModel?.name ?? "Model", conventions);
			fromClause = quotedRelatedTable;
			joinCondition = `${quotedRelatedTable}.${dialect.quoteIdentifier(foreignKey)} = ${quotedSelfTable}.${dialect.quoteIdentifier(localKey)}`;
		} else if (relationType === "belongsTo") {
			const ownerKey = definition.localKey ?? RelatedModel.primaryKey ?? "id";
			const foreignKey = definition.foreignKey ?? inferBelongsToForeignKey(relationName, conventions);
			fromClause = quotedRelatedTable;
			joinCondition = `${quotedRelatedTable}.${dialect.quoteIdentifier(ownerKey)} = ${quotedSelfTable}.${dialect.quoteIdentifier(foreignKey)}`;
		} else if (relationType === "belongsToMany") {
			const pivotTableName = definition.pivot ?? inferPivotTable(selfModel?.name ?? "Model", RelatedModel.name, conventions);
			const quotedPivot = dialect.quoteIdentifier(pivotTableName);
			const pivotLocalCol = definition.localKey ?? inferPivotKey(selfModel?.name ?? "Model", conventions);
			const pivotForeignCol = definition.foreignKey ?? inferPivotKey(RelatedModel.name, conventions);
			const selfPk = definition.pivotLocalKey ?? selfModel?.primaryKey ?? "id";
			const relatedPk = definition.pivotForeignKey ?? RelatedModel.primaryKey ?? "id";
			if (!constraintOps || constraintOps.length === 0) {
				fromClause = quotedPivot;
				joinCondition = `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;
			} else {
				fromClause = `${quotedPivot} INNER JOIN ${quotedRelatedTable} ON ${quotedRelatedTable}.${dialect.quoteIdentifier(relatedPk)} = ${quotedPivot}.${dialect.quoteIdentifier(pivotForeignCol)}`;
				joinCondition = `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;
			}
		} else throw new Error(`${opType}: Unsupported relation type "${relationType}" for "${relationName}"`);
		const fullWhere = where.fragment ? `${joinCondition} AND ${where.fragment}` : joinCondition;
		if (opType === "has" && (operator !== void 0 && operator !== ">=" || (count ?? 1) !== 1)) return {
			expression: `(SELECT COUNT(*) FROM ${fromClause} WHERE ${fullWhere}) ${operator ?? ">="} ${count ?? 1}`,
			bindings: where.bindings
		};
		return {
			expression: `${opType === "doesntHave" || opType === "whereDoesntHave" ? "NOT EXISTS" : "EXISTS"} (SELECT 1 FROM ${fromClause} WHERE ${fullWhere})`,
			bindings: where.bindings
		};
	}
	/**
	* Translate each entry in `countRelations` into a correlated COUNT subquery
	* emitted as a `selectRaw` operation. Runs after `applyJoinRelations` so the
	* "preserve main table columns" guard sees any joins already in place.
	*
	* Idempotent — guarded by `countRelationsApplied` so repeat calls (e.g.
	* `parse()` followed by `get()`) don't double-emit operations.
	*/
	applyCountRelations() {
		if (this.countRelationsApplied || this.countRelations.size === 0) return;
		this.countRelationsApplied = true;
		this.ensureMainColumnsForCount();
		for (const [alias, entry] of this.countRelations) {
			const definition = this.relationDefinitions?.[entry.relation];
			if (!definition) {
				const modelName = this.modelClass?.name ?? "unknown";
				throw new Error(`withCount: Relation "${entry.relation}" not found on model ${modelName}`);
			}
			const RelatedModel = tryResolveModelClass(definition.model);
			if (!RelatedModel || !RelatedModel.table) throw new Error(`withCount: Related model not resolvable for "${entry.relation}" (alias "${alias}")`);
			const subquery = this.buildCountSubquery(alias, entry.relation, definition, RelatedModel, entry.constraintOps);
			this.addOperation("selectRaw", {
				expression: subquery.expression,
				bindings: subquery.bindings
			});
		}
	}
	/**
	* Without an explicit `select(...)` or any `selectRaw`/`selectRelatedColumns`
	* already pushed, the parser's "no selects → SELECT *" fallback would be
	* suppressed once we add count expressions. Push `<table>.*` first so the
	* caller's columns survive.
	*/
	ensureMainColumnsForCount() {
		if (this.operations.some((op) => op.type === "select" || op.type === "selectRaw" || op.type === "selectRelatedColumns")) return;
		const quotedTable = this.driver.dialect.quoteIdentifier(this.table);
		this.addOperation("selectRaw", {
			expression: `${quotedTable}.*`,
			bindings: []
		});
	}
	/**
	* Build a single correlated-subquery expression for a count entry. Branches
	* on relation type (hasMany/hasOne/belongsTo/belongsToMany). The optional
	* constraint callback's where-ops are translated via a sub-parser and
	* spliced into the subquery's WHERE clause.
	*/
	buildCountSubquery(alias, relationName, definition, RelatedModel, constraintOps) {
		const dialect = this.driver.dialect;
		const quotedAlias = dialect.quoteIdentifier(alias);
		const quotedSelfTable = dialect.quoteIdentifier(this.table);
		const quotedRelatedTable = dialect.quoteIdentifier(RelatedModel.table);
		const relationType = definition.type;
		const selfModel = this.modelClass;
		const relatedMeta = RelatedModel;
		const conventions = this.dataSource?.relationDefaults;
		if (relationType === "hasMany" || relationType === "hasOne") {
			const localKey = definition.localKey ?? selfModel?.primaryKey ?? "id";
			const foreignKey = definition.foreignKey ?? inferHasForeignKey(selfModel?.name ?? "Model", conventions);
			const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);
			const fkCondition = `${quotedRelatedTable}.${dialect.quoteIdentifier(foreignKey)} = ${quotedSelfTable}.${dialect.quoteIdentifier(localKey)}`;
			return {
				expression: `(SELECT COUNT(*) FROM ${quotedRelatedTable} WHERE ${where.fragment ? `${fkCondition} AND ${where.fragment}` : fkCondition})::int AS ${quotedAlias}`,
				bindings: where.bindings
			};
		}
		if (relationType === "belongsTo") {
			const ownerKey = definition.localKey ?? relatedMeta.primaryKey ?? "id";
			const foreignKey = definition.foreignKey ?? inferBelongsToForeignKey(relationName, conventions);
			const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);
			const condition = `${quotedRelatedTable}.${dialect.quoteIdentifier(ownerKey)} = ${quotedSelfTable}.${dialect.quoteIdentifier(foreignKey)}`;
			return {
				expression: `(SELECT COUNT(*) FROM ${quotedRelatedTable} WHERE ${where.fragment ? `${condition} AND ${where.fragment}` : condition})::int AS ${quotedAlias}`,
				bindings: where.bindings
			};
		}
		if (relationType === "belongsToMany") {
			const pivotTableName = definition.pivot ?? inferPivotTable(selfModel?.name ?? "Model", relatedMeta.name, conventions);
			const quotedPivot = dialect.quoteIdentifier(pivotTableName);
			const pivotLocalCol = definition.localKey ?? inferPivotKey(selfModel?.name ?? "Model", conventions);
			const pivotForeignCol = definition.foreignKey ?? inferPivotKey(relatedMeta.name, conventions);
			const selfPk = definition.pivotLocalKey ?? selfModel?.primaryKey ?? "id";
			const relatedPk = definition.pivotForeignKey ?? relatedMeta.primaryKey ?? "id";
			const pivotCondition = `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;
			if (!constraintOps || constraintOps.length === 0) return {
				expression: `(SELECT COUNT(*) FROM ${quotedPivot} WHERE ${pivotCondition})::int AS ${quotedAlias}`,
				bindings: []
			};
			const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);
			return {
				expression: `(SELECT COUNT(*) FROM ${quotedPivot} ${`INNER JOIN ${quotedRelatedTable} ON ${quotedRelatedTable}.${dialect.quoteIdentifier(relatedPk)} = ${quotedPivot}.${dialect.quoteIdentifier(pivotForeignCol)}`} WHERE ${where.fragment ? `${pivotCondition} AND ${where.fragment}` : pivotCondition})::int AS ${quotedAlias}`,
				bindings: where.bindings
			};
		}
		throw new Error(`withCount: Unsupported relation type "${relationType}" for "${relationName}"`);
	}
	/**
	* Run a constraint's where-ops through a fresh sub-parser to obtain a SQL
	* WHERE-fragment plus bindings. Strips the leading `WHERE ` and rewrites
	* `$N` placeholders back to `?` so the outer parser renumbers them
	* consistently when it processes the enclosing `selectRaw` operation.
	*
	* Non-where ops (orderBy / limit / etc.) are silently dropped — they have
	* no meaning inside a COUNT subquery.
	*/
	extractCountWhereFragment(relatedTable, constraintOps) {
		if (!constraintOps || constraintOps.length === 0) return {
			fragment: "",
			bindings: []
		};
		const whereOps = constraintOps.filter((op) => op.type.startsWith("where") || op.type.startsWith("orWhere"));
		if (whereOps.length === 0) return {
			fragment: "",
			bindings: []
		};
		const { query = "", bindings = [] } = new PostgresQueryParser({
			table: relatedTable,
			operations: toParserOps(whereOps)
		}).parse();
		const match = query.match(/WHERE\s+(.+)$/);
		if (!match) return {
			fragment: "",
			bindings: []
		};
		return {
			fragment: match[1].replace(/\$\d+/g, "?"),
			bindings: bindings ?? []
		};
	}
	/**
	* Rewrite every `having` op whose field matches a recorded aggregate alias
	* into a `havingRaw` carrying the underlying SQL expression. PostgreSQL
	* forbids SELECT aliases in HAVING, so `having("revenue", ">", 1000)` on a
	* `groupBy` aggregate would otherwise throw at runtime. A `having` on a
	* grouped column (no alias match) is left untouched. Runs at parse time
	* (not in the `groupBy` override) so it is independent of fluent call order.
	*
	* Idempotent — guarded by `groupByAggregatesApplied` so repeat calls (e.g.
	* `parse()` followed by `get()`) don't double-process.
	*/
	applyGroupByAggregates() {
		if (this.groupByAggregatesApplied) return;
		this.groupByAggregatesApplied = true;
		if (this.aggregateAliases.size === 0) return;
		this.operations = this.operations.map((operation) => {
			if (operation.type !== "having") return operation;
			const field = operation.data.field;
			const sql = this.aggregateAliases.get(field);
			if (!sql) return operation;
			return {
				type: "havingRaw",
				data: {
					expression: `${sql} ${operation.data.operator ?? "="} ?`,
					bindings: [operation.data.value]
				}
			};
		});
		this.rebuildIndex();
	}
	/**
	* Run the RelationLoader against the fetched rows for every relation
	* registered via `with()`. Mutates each model instance in place — attaches
	* loaded relations onto `model.loadedRelations` and as direct properties.
	*
	* Lives here (not in `buildQuery`'s `onFetched` callback as it did
	* historically) so any code path that calls `get()` — including
	* `Model.newQueryBuilder()` direct instantiation, custom builder subclasses
	* via `static builder`, or any `eagerLoadRelations`-bearing builder — gets
	* eager-loading. Previously the loader was only installed when the builder
	* was constructed via `Model.query()` / `buildQuery`, so bypassing that
	* factory made `with()` a silent no-op.
	*
	* Skipped silently when `modelClass` is absent (raw driver-level
	* `queryBuilder()` usage has no relations map to consult).
	*/
	async applyEagerLoading(records) {
		if (!this.modelClass || this.eagerLoadRelations.size === 0 || records.length === 0) return;
		const constraints = {};
		for (const [name, constraint] of this.eagerLoadRelations) if (typeof constraint === "function") constraints[name] = constraint;
		await new RelationLoader(records, this.modelClass).load([...this.eagerLoadRelations.keys()], constraints);
	}
	/**
	* Extract per-relation data from raw DB rows (before hydration).
	* Returns a Map of row index → nested relation data tree.
	*/
	extractJoinedRelationData(records) {
		const result = /* @__PURE__ */ new Map();
		if (this.joinRelations.size === 0) return result;
		records.forEach((record, index) => {
			const relationData = {};
			const sortedPaths = Array.from(this.joinRelations.keys()).sort((a, b) => a.split(".").length - b.split(".").length);
			for (const path of sortedPaths) {
				const columnName = this.joinRelations.get(path).alias;
				const relatedData = record[columnName];
				delete record[columnName];
				const parsedData = relatedData !== null && !(typeof relatedData === "object" && Object.values(relatedData).every((v) => v === null)) ? relatedData : null;
				const parts = path.split(".");
				const lastPart = parts.pop();
				let current = relationData;
				for (const part of parts) {
					if (!current[part]) current[part] = {};
					current = current[part];
				}
				current[lastPart] = parsedData;
			}
			result.set(index, relationData);
		});
		return result;
	}
	/**
	* Attach extracted relation data to hydrated model instances.
	*/
	attachJoinedRelations(records, joinedData) {
		if (this.joinRelations.size === 0) return;
		const attachNested = (model, dataTree, currentPath = "") => {
			if (!dataTree || typeof dataTree !== "object") return;
			for (const [key, data] of Object.entries(dataTree)) {
				const path = currentPath ? `${currentPath}.${key}` : key;
				const config = this.joinRelations.get(path);
				if (!config) continue;
				if (data === null) {
					attachLoadedRelation(model, key, null);
					continue;
				}
				const RelatedModel = resolveModelClass(config.model);
				if (!RelatedModel) continue;
				const childKeys = Array.from(this.joinRelations.keys()).filter((p) => p.startsWith(`${path}.`)).map((p) => p.split(".")[path.split(".").length]);
				if (config.type === "hasMany") attachLoadedRelation(model, key, (Array.isArray(data) ? data : []).map((row) => {
					const rowData = { ...row };
					for (const childKey of childKeys) delete rowData[childKey];
					return RelatedModel.hydrate(rowData);
				}));
				else {
					const modelData = { ...data };
					for (const childKey of childKeys) delete modelData[childKey];
					const relatedInstance = RelatedModel.hydrate(modelData);
					attachNested(relatedInstance, data, path);
					attachLoadedRelation(model, key, relatedInstance);
				}
			}
		};
		records.forEach((model, index) => {
			const relationData = joinedData.get(index);
			if (relationData) attachNested(model, relationData);
		});
	}
	/**
	* Build a WHERE-only SQL fragment from `where*` operations on the current builder.
	* Used by DELETE / UPDATE / increment paths.
	*/
	buildFilter() {
		const whereOps = this.operations.filter((op) => op.type.includes("where") || op.type.includes("Where"));
		if (whereOps.length === 0) return {
			sql: "",
			params: []
		};
		const { query = "", bindings = [] } = new PostgresQueryParser({
			table: this.table,
			operations: toParserOps(whereOps)
		}).parse();
		const whereMatch = query.match(/WHERE .+$/);
		return {
			sql: whereMatch ? whereMatch[0] : "",
			params: bindings
		};
	}
};
//#endregion
export { PostgresQueryBuilder };

//# sourceMappingURL=postgres-query-builder.mjs.map