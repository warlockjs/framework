//#region ../../@warlock.js/cascade/src/query-builder/query-builder.ts
/**
* Pure, driver-agnostic query builder.
*
* Records operations in `operations[]`. Subclasses own execution, parsing, and
* driver-specific clause generation. Safe to instantiate directly inside
* callbacks where only operation recording is needed.
*
* @example
* ```ts
* // Driver subclass usage:
* const users = await User.query()
*   .select(["id", "name"])
*   .where("status", "active")
*   .where(q => q.where("role", "admin").orWhere("role", "mod"))
*   .orderBy("createdAt", "desc")
*   .limit(10)
*   .get();
*
* // Direct instantiation (callback context — no driver needed):
* joinWith({ actions: q => q.where("status", "pending").limit(5) });
* // The sub-QB's operations[] are captured and stored in the joinWith op data.
* ```
*/
var QueryBuilder = class QueryBuilder {
	/** Flat, ordered list of recorded operations. Public for parser access. */
	operations = [];
	/**
	* type → ordered list of indices into `operations[]`.
	*
	* Protected (not private) so:
	*  - `rebuildIndex()` can reset it after direct `operations[]` mutation.
	*  - Subclasses can inspect it without unsafe casts.
	*
	* External consumers should use `getOps(type)` instead.
	*/
	opIndex = /* @__PURE__ */ new Map();
	/** Global scope definitions injected by Model.query(). Keyed by scope name. */
	pendingGlobalScopes;
	/** Local scope callbacks injected by Model.query(). Applied on demand via scope(). */
	availableLocalScopes;
	/** Names of global scopes that have been intentionally disabled. */
	disabledGlobalScopes = /* @__PURE__ */ new Set();
	/** True once the driver subclass has applied pending scopes. */
	scopesApplied = false;
	/** Relations to eager-load via separate queries. */
	eagerLoadRelations = /* @__PURE__ */ new Map();
	/** Count expressions to emit per result row, keyed by output column alias. */
	countRelations = /* @__PURE__ */ new Map();
	/** Relation definition map injected from the owning Model. */
	relationDefinitions;
	/** The Model class reference, required for relation resolution. */
	modelClass;
	/**
	* Append an operation to `operations[]` and update `opIndex`.
	* Every fluent method calls this.
	*/
	addOperation(type, data) {
		const idx = this.operations.length;
		this.operations.push({
			type,
			data
		});
		const list = this.opIndex.get(type);
		if (list) list.push(idx);
		else this.opIndex.set(type, [idx]);
	}
	/**
	* Return all recorded operations of the specified types in original
	* insertion order.
	*
	* @example
	* builder.getOps("where", "orWhere", "whereIn")
	*/
	getOps(...types) {
		if (types.length === 1) return (this.opIndex.get(types[0]) ?? []).map((i) => this.operations[i]);
		const result = [];
		for (const type of types) for (const idx of this.opIndex.get(type) ?? []) result.push({
			idx,
			op: this.operations[idx]
		});
		return result.sort((a, b) => a.idx - b.idx).map((r) => r.op);
	}
	/**
	* Rebuild `opIndex` from scratch.
	*
	* Call this after any direct mutation of `this.operations[]` (e.g. scope
	* injection, joinWith consumption in the executor, clone post-processing).
	*/
	rebuildIndex() {
		this.opIndex = /* @__PURE__ */ new Map();
		for (let i = 0; i < this.operations.length; i++) {
			const type = this.operations[i].type;
			const list = this.opIndex.get(type);
			if (list) list.push(i);
			else this.opIndex.set(type, [i]);
		}
	}
	/**
	* Factory for sub-QueryBuilders used inside callbacks.
	*
	* Override in driver subclasses to return a driver-typed instance, so that
	* driver-specific methods (e.g. `whereArrayContains`) are available inside
	* nested `where(q => ...)` / `whereHas` / `joinWith` callbacks.
	*
	* @example
	* // In PostgresQueryBuilder:
	* protected override subQuery(): QueryBuilder {
	*   return new PostgresQueryBuilder("__sub__", this.dataSource);
	* }
	*/
	subQuery() {
		return new QueryBuilder();
	}
	/**
	* Shallow-clone this builder — copies operations, opIndex, and all shared state.
	*
	* Subclasses MUST call `super.clone()` and then copy their own fields
	* (dataSource, joinRelations, …).
	*/
	clone() {
		const cloned = Object.create(Object.getPrototypeOf(this));
		cloned.operations = [...this.operations];
		cloned.opIndex = new Map(Array.from(this.opIndex.entries()).map(([k, v]) => [k, [...v]]));
		cloned.pendingGlobalScopes = this.pendingGlobalScopes;
		cloned.availableLocalScopes = this.availableLocalScopes;
		cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
		cloned.scopesApplied = this.scopesApplied;
		cloned.eagerLoadRelations = new Map(this.eagerLoadRelations);
		cloned.countRelations = new Map(this.countRelations);
		cloned.relationDefinitions = this.relationDefinitions;
		cloned.modelClass = this.modelClass;
		return cloned;
	}
	/** Disable one or more named global scopes for this query. */
	withoutGlobalScope(...scopeNames) {
		scopeNames.forEach((name) => this.disabledGlobalScopes.add(name));
		return this;
	}
	/** Disable ALL pending global scopes for this query. */
	withoutGlobalScopes() {
		this.pendingGlobalScopes?.forEach((_, name) => this.disabledGlobalScopes.add(name));
		return this;
	}
	/**
	* Apply a registered local scope by name.
	* @throws if no local scopes are available or the named scope is not found
	*/
	scope(scopeName, ...args) {
		if (!this.availableLocalScopes) throw new Error("No local scopes available on this query builder.");
		const cb = this.availableLocalScopes.get(scopeName);
		if (!cb) throw new Error(`Local scope "${scopeName}" not found.`);
		cb(this, ...args);
		return this;
	}
	where(...args) {
		if (args.length === 1 && typeof args[0] === "function") {
			const sub = this.subQuery();
			args[0](sub);
			this.addOperation("where", { nested: sub.operations });
		} else if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) for (const [key, value] of Object.entries(args[0])) this.addOperation("where", {
			field: key,
			operator: "=",
			value
		});
		else if (args.length === 2) this.addOperation("where", {
			field: args[0],
			operator: "=",
			value: args[1]
		});
		else this.addOperation("where", {
			field: args[0],
			operator: args[1],
			value: args[2]
		});
		return this;
	}
	orWhere(...args) {
		if (args.length === 1 && typeof args[0] === "function") {
			const sub = this.subQuery();
			args[0](sub);
			this.addOperation("orWhere", { nested: sub.operations });
		} else if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) for (const [key, value] of Object.entries(args[0])) this.addOperation("orWhere", {
			field: key,
			operator: "=",
			value
		});
		else if (args.length === 2) this.addOperation("orWhere", {
			field: args[0],
			operator: "=",
			value: args[1]
		});
		else this.addOperation("orWhere", {
			field: args[0],
			operator: args[1],
			value: args[2]
		});
		return this;
	}
	/**
	* Raw WHERE expression in the target dialect (AND).
	*
	* @example
	* q.whereRaw("age > ? AND role = ?", [18, "admin"])           // SQL
	* q.whereRaw({ $expr: { $gt: ["$stock", "$reserved"] } })     // MongoDB
	*/
	whereRaw(expression, bindings) {
		this.addOperation("whereRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/** Raw OR WHERE expression. */
	orWhereRaw(expression, bindings) {
		this.addOperation("orWhereRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/**
	* Compare two columns directly (AND).
	* @example q.whereColumn("stock", ">", "reserved")
	*/
	whereColumn(first, operator, second) {
		this.addOperation("whereColumn", {
			first,
			operator,
			second
		});
		return this;
	}
	/** Compare two columns directly (OR). */
	orWhereColumn(first, operator, second) {
		this.addOperation("orWhereColumn", {
			first,
			operator,
			second
		});
		return this;
	}
	/** Compare multiple column pairs in one call. */
	whereColumns(comparisons) {
		for (const [left, operator, right] of comparisons) this.whereColumn(left, operator, right);
		return this;
	}
	/**
	* Field value must fall between two other column values.
	* Stored as a `whereBetween` op with `useColumns: true` so the SQL parser
	* knows to quote the values as identifiers rather than bind them.
	*/
	whereBetweenColumns(field, lowerColumn, upperColumn) {
		this.addOperation("whereBetween", {
			field,
			lowerColumn,
			upperColumn,
			useColumns: true
		});
		return this;
	}
	/** WHERE field IN values. */
	whereIn(field, values) {
		this.addOperation("whereIn", {
			field,
			values
		});
		return this;
	}
	/** WHERE field NOT IN values. */
	whereNotIn(field, values) {
		this.addOperation("whereNotIn", {
			field,
			values
		});
		return this;
	}
	/** WHERE field IS NULL. */
	whereNull(field) {
		this.addOperation("whereNull", { field });
		return this;
	}
	/** WHERE field IS NOT NULL. */
	whereNotNull(field) {
		this.addOperation("whereNotNull", { field });
		return this;
	}
	/** WHERE field BETWEEN low AND high. */
	whereBetween(field, range) {
		this.addOperation("whereBetween", {
			field,
			range
		});
		return this;
	}
	/** WHERE field NOT BETWEEN low AND high. */
	whereNotBetween(field, range) {
		this.addOperation("whereNotBetween", {
			field,
			range
		});
		return this;
	}
	/**
	* LIKE pattern match (AND).
	* @example q.whereLike("email", "%@gmail.com")
	*/
	whereLike(field, pattern) {
		const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
		this.addOperation("whereLike", {
			field,
			pattern: patternStr
		});
		return this;
	}
	/** NOT LIKE pattern match. */
	whereNotLike(field, pattern) {
		const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
		this.addOperation("whereNotLike", {
			field,
			pattern: patternStr
		});
		return this;
	}
	/** Starts with a prefix. */
	whereStartsWith(field, value) {
		return this.whereLike(field, `${value}%`);
	}
	/** Does NOT start with a prefix. */
	whereNotStartsWith(field, value) {
		return this.whereNotLike(field, `${value}%`);
	}
	/** Ends with a suffix. */
	whereEndsWith(field, value) {
		return this.whereLike(field, `%${value}`);
	}
	/** Does NOT end with a suffix. */
	whereNotEndsWith(field, value) {
		return this.whereNotLike(field, `%${value}`);
	}
	/**
	* Match on date portion only (time ignored).
	* @example q.whereDate("createdAt", "2024-05-01")
	*/
	whereDate(field, value) {
		this.addOperation("whereDate", {
			field,
			value
		});
		return this;
	}
	/** Alias for whereDate. */
	whereDateEquals(field, value) {
		return this.whereDate(field, value);
	}
	/** Field date is before value. */
	whereDateBefore(field, value) {
		this.addOperation("whereDateBefore", {
			field,
			value
		});
		return this;
	}
	/** Field date is after value. */
	whereDateAfter(field, value) {
		this.addOperation("whereDateAfter", {
			field,
			value
		});
		return this;
	}
	/** Field date is within a range [from, to]. */
	whereDateBetween(field, range) {
		this.addOperation("whereDateBetween", {
			field,
			range
		});
		return this;
	}
	/** Field date is NOT within a range. */
	whereDateNotBetween(field, range) {
		this.addOperation("whereNotBetween", {
			field,
			range
		});
		return this;
	}
	/**
	* Match on the time portion of a datetime field.
	* Emits a `whereRaw` op with a driver-agnostic marker; the driver parser
	* rewrites it to the appropriate SQL (`TIME(field) = ?`) or Mongo expression.
	*/
	whereTime(field, value) {
		this.addOperation("whereRaw", {
			expression: `TIME(${field}) = ?`,
			bindings: [value]
		});
		return this;
	}
	/**
	* Day-of-month from a date field (1–31).
	* Uses a `whereRaw` op so SQL parsers get the `EXTRACT` expression directly.
	* MongoDB drivers override to emit `$dayOfMonth`.
	*/
	whereDay(field, value) {
		this.addOperation("whereRaw", {
			expression: `EXTRACT(DAY FROM ${field}) = ?`,
			bindings: [value]
		});
		return this;
	}
	/** Month extracted from a date field (1–12). */
	whereMonth(field, value) {
		this.addOperation("whereRaw", {
			expression: `EXTRACT(MONTH FROM ${field}) = ?`,
			bindings: [value]
		});
		return this;
	}
	/** Year extracted from a date field. */
	whereYear(field, value) {
		this.addOperation("whereRaw", {
			expression: `EXTRACT(YEAR FROM ${field}) = ?`,
			bindings: [value]
		});
		return this;
	}
	/**
	* JSON/array path contains the given value.
	* @example q.whereJsonContains("tags", "typescript")
	*/
	whereJsonContains(path, value) {
		this.addOperation("whereJsonContains", {
			path,
			value
		});
		return this;
	}
	/** JSON/array path does NOT contain the value. */
	whereJsonDoesntContain(path, value) {
		this.addOperation("whereJsonDoesntContain", {
			path,
			value
		});
		return this;
	}
	/**
	* JSON path key exists.
	* Uses a `whereRaw` so existing SQL parsers get `IS NOT NULL` immediately.
	*/
	whereJsonContainsKey(path) {
		this.addOperation("whereRaw", {
			expression: `${path} IS NOT NULL`,
			bindings: []
		});
		return this;
	}
	/**
	* Constrain the length of a JSON array at a path.
	* @example q.whereJsonLength("tags", ">", 3)
	*/
	whereJsonLength(path, operator, value) {
		this.addOperation("whereRaw", {
			expression: `jsonb_array_length(${path}) ${operator} ?`,
			bindings: [value]
		});
		return this;
	}
	/** JSON path must resolve to an array. */
	whereJsonIsArray(path) {
		this.addOperation("whereRaw", {
			expression: `jsonb_typeof(${path}) = 'array'`,
			bindings: []
		});
		return this;
	}
	/** JSON path must resolve to an object. */
	whereJsonIsObject(path) {
		this.addOperation("whereRaw", {
			expression: `jsonb_typeof(${path}) = 'object'`,
			bindings: []
		});
		return this;
	}
	/**
	* Constrain the number of elements in an array field.
	* @example q.whereArrayLength("roles", ">=", 2)
	*/
	whereArrayLength(field, operator, value) {
		this.addOperation("whereRaw", {
			expression: `array_length(${field}, 1) ${operator} ?`,
			bindings: [value]
		});
		return this;
	}
	/** WHERE id = value. */
	whereId(value) {
		return this.where("id", value);
	}
	/** WHERE id IN values. */
	whereIds(values) {
		return this.whereIn("id", values);
	}
	/** WHERE uuid = value. */
	whereUuid(value) {
		return this.where("uuid", value);
	}
	/** WHERE ulid = value. */
	whereUlid(value) {
		return this.where("ulid", value);
	}
	/**
	* Full-text search across one or more fields.
	* @example q.whereFullText(["title", "body"], "typescript")
	*/
	whereFullText(fields, query) {
		this.addOperation("whereFullText", {
			fields: Array.isArray(fields) ? fields : [fields],
			query
		});
		return this;
	}
	/** Full-text search (OR). */
	orWhereFullText(fields, query) {
		return this.whereFullText(fields, query);
	}
	/** Alias for whereFullText with a single field. */
	whereSearch(field, query) {
		return this.whereFullText([field], query);
	}
	/**
	* Text search with optional extra equality filters.
	* MongoDB-style convenience shorthand.
	*/
	textSearch(query, filters) {
		if (filters) for (const [key, value] of Object.entries(filters)) this.where(key, value);
		return this;
	}
	whereExists(param) {
		if (typeof param === "function") {
			const sub = this.subQuery();
			param(sub);
			this.addOperation("whereExists", { subquery: sub.operations });
		} else this.addOperation("whereNotNull", { field: param });
		return this;
	}
	whereNotExists(param) {
		if (typeof param === "function") {
			const sub = this.subQuery();
			param(sub);
			this.addOperation("whereNotExists", { subquery: sub.operations });
		} else this.addOperation("whereNull", { field: param });
		return this;
	}
	whereSize(field, ...args) {
		const operator = args.length === 2 ? args[0] : "=";
		const size = args.length === 2 ? args[1] : args[0];
		return this.whereArrayLength(field, operator, size);
	}
	/**
	* AND NOT wrapper — negate a nested group.
	* @example q.whereNot(q => q.where("status", "banned").where("role", "user"))
	*/
	whereNot(callback) {
		const sub = this.subQuery();
		callback(sub);
		this.addOperation("whereNot", { nested: sub.operations });
		return this;
	}
	/** OR NOT wrapper. */
	orWhereNot(callback) {
		const sub = this.subQuery();
		callback(sub);
		this.addOperation("orWhereNot", { nested: sub.operations });
		return this;
	}
	join(...args) {
		if (args.length === 3) this.addOperation("join", {
			table: args[0],
			localField: args[1],
			foreignField: args[2]
		});
		else this.addOperation("join", args[0]);
		return this;
	}
	leftJoin(...args) {
		if (args.length === 3) this.addOperation("leftJoin", {
			table: args[0],
			localField: args[1],
			foreignField: args[2]
		});
		else this.addOperation("leftJoin", args[0]);
		return this;
	}
	rightJoin(...args) {
		if (args.length === 3) this.addOperation("rightJoin", {
			table: args[0],
			localField: args[1],
			foreignField: args[2]
		});
		else this.addOperation("rightJoin", args[0]);
		return this;
	}
	innerJoin(...args) {
		if (args.length === 3) this.addOperation("innerJoin", {
			table: args[0],
			localField: args[1],
			foreignField: args[2]
		});
		else this.addOperation("innerJoin", args[0]);
		return this;
	}
	fullJoin(...args) {
		if (args.length === 3) this.addOperation("fullJoin", {
			table: args[0],
			localField: args[1],
			foreignField: args[2]
		});
		else this.addOperation("fullJoin", args[0]);
		return this;
	}
	/** CROSS JOIN. */
	crossJoin(table) {
		this.addOperation("crossJoin", { table });
		return this;
	}
	/** Raw JOIN expression. Driver responsible for handling. */
	joinRaw(expression, bindings) {
		this.addOperation("joinRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/**
	* Eager-load named relations via a single JOIN / $lookup query.
	*
	* Constraints are eagerly resolved at call time:
	*  - Callbacks are invoked immediately → `subOps` stored in op data.
	*  - Column shorthands are parsed into a `columns[]` array.
	*
	* The driver executor reads the `joinWith` op and uses the resolved data
	* alongside its own relation definition map to emit the appropriate SQL JOIN
	* or MongoDB $lookup stage.
	*
	* Supported arg forms (may be mixed):
	*   - `"author"` / `["author", "category"]` — no constraint
	*   - `{ author: "id,name" }` — column shorthand
	*   - `{ actions: q => q.where("status","pending").limit(5) }` — callback
	*
	* @example
	* Post.joinWith("author", "category")
	* ChatMessage.joinWith({ actions: q => q.where("status", "pending").limit(5) })
	* ChatMessage.joinWith({ org: "id,name", actions: q => q.orderBy("sort_order") })
	*/
	joinWith(...args) {
		const resolved = {};
		for (const arg of args) if (typeof arg === "string") resolved[arg] = {};
		else if (Array.isArray(arg)) for (const rel of arg) resolved[rel] = {};
		else if (typeof arg === "object" && arg !== null) for (const [rel, constraint] of Object.entries(arg)) if (typeof constraint === "function") {
			const sub = this.subQuery();
			constraint(sub);
			resolved[rel] = { subOps: sub.operations };
		} else if (typeof constraint === "string" && constraint !== "") resolved[rel] = { columns: constraint.split(",").map((s) => s.trim()).filter(Boolean) };
		else resolved[rel] = {};
		this.addOperation("joinWith", { resolved });
		return this;
	}
	/**
	* Eager-load relations via separate queries (N+1 avoided by batching).
	*
	* @example
	* q.with("posts")
	* q.with("posts", q => q.where("published", true))
	* q.with({ posts: true, comments: q => q.limit(5) })
	*/
	with(...args) {
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (typeof arg === "string") {
				const next = args[i + 1];
				if (typeof next === "function") {
					this.eagerLoadRelations.set(arg, next);
					i++;
				} else this.eagerLoadRelations.set(arg, true);
			} else if (typeof arg === "object" && arg !== null) for (const [key, value] of Object.entries(arg)) this.eagerLoadRelations.set(key, value);
		}
		return this;
	}
	/**
	* Register one or more relation counts to emit alongside each result row.
	*
	* Accepts:
	* - Bare relation names (variadic strings or array): `withCount("posts", "comments")`
	* - Alias shorthand: `withCount("posts as totalPosts")`
	* - Object form for per-relation constraints / aliases:
	*   `withCount({ posts: true, "posts as approved": (q) => q.where("approved", true) })`
	*
	* Each entry is stored in `countRelations` keyed by its output column alias
	* (default `${relationName}Count`). The driver subclass consumes the map at
	* execute time to emit count expressions.
	*
	* @example
	* ```typescript
	* await User.query().withCount("posts").get();              // postsCount
	* await User.query().withCount("posts as totalPosts").get(); // totalPosts
	* await User.query()
	*   .withCount({
	*     posts: true,
	*     "posts as published": (q) => q.where("isPublished", true),
	*     comments: "commentTotal",
	*   })
	*   .get();
	* ```
	*/
	withCount(...args) {
		for (const arg of args) {
			if (typeof arg === "string") {
				this.recordCountEntry(arg);
				continue;
			}
			if (Array.isArray(arg)) {
				for (const spec of arg) this.recordCountEntry(spec);
				continue;
			}
			if (typeof arg === "object" && arg !== null) {
				const entries = Object.entries(arg);
				for (const [key, value] of entries) if (value === true) this.recordCountEntry(key);
				else if (typeof value === "string") this.recordCountEntry(`${key} as ${value}`);
				else if (typeof value === "function") this.recordCountEntry(key, value);
			}
		}
		return this;
	}
	/**
	* Parse a count spec ("relation" or "relation as alias") into its relation
	* name and output alias, optionally capturing a constraint callback's
	* operations via a sub-builder. Stored in `countRelations` keyed by alias.
	*/
	recordCountEntry(spec, constraint) {
		const { relation, alias } = this.parseCountSpec(spec);
		let constraintOps;
		if (constraint) {
			const sub = this.subQuery();
			constraint(sub);
			constraintOps = sub.operations;
		}
		this.countRelations.set(alias, {
			relation,
			constraintOps
		});
	}
	/**
	* Split a `"<relation>"` or `"<relation> as <alias>"` spec. Returns the
	* resolved relation name and the output column alias (defaulting to
	* `${relation}Count` when no `as` is present).
	*/
	parseCountSpec(spec) {
		const trimmed = spec.trim();
		const match = /^(.+?)\s+as\s+(.+)$/i.exec(trimmed);
		if (!match) return {
			relation: trimmed,
			alias: `${trimmed}Count`
		};
		return {
			relation: match[1].trim(),
			alias: match[2].trim()
		};
	}
	/**
	* Filter to rows that have at least one related record.
	* @example q.has("comments")
	* @example q.has("comments", ">=", 3)
	*/
	has(relation, operator, count) {
		this.addOperation("has", {
			relation,
			operator: operator ?? ">=",
			count: count ?? 1
		});
		return this;
	}
	/**
	* Filter to rows with related records matching a sub-query (AND).
	* @example q.whereHas("comments", q => q.where("approved", true))
	*/
	whereHas(relation, callback) {
		const sub = this.subQuery();
		callback(sub);
		this.addOperation("whereHas", {
			relation,
			subquery: sub.operations
		});
		return this;
	}
	/** Same as whereHas but OR-joined. */
	orWhereHas(relation, callback) {
		const sub = this.subQuery();
		callback(sub);
		this.addOperation("orWhereHas", {
			relation,
			subquery: sub.operations
		});
		return this;
	}
	/** Filter to rows with NO related records. */
	doesntHave(relation) {
		this.addOperation("doesntHave", { relation });
		return this;
	}
	/** Filter to rows with NO related records matching conditions. */
	whereDoesntHave(relation, callback) {
		const sub = this.subQuery();
		callback(sub);
		this.addOperation("whereDoesntHave", {
			relation,
			subquery: sub.operations
		});
		return this;
	}
	select(...args) {
		if (args.length === 1 && Array.isArray(args[0])) this.addOperation("select", { fields: args[0] });
		else if (args.length === 1 && typeof args[0] === "object" && !Array.isArray(args[0])) this.addOperation("select", { fields: args[0] });
		else this.addOperation("select", { fields: args.flat() });
		return this;
	}
	/** Select a field under an alias. @example q.selectAs("fullName", "name") */
	selectAs(field, alias) {
		this.addOperation("select", { fields: { [field]: alias } });
		return this;
	}
	/**
	* Raw SELECT expression.
	* @example q.selectRaw("COUNT(*) AS total")
	*/
	selectRaw(expression, bindings) {
		this.addOperation("selectRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/** Multiple raw SELECT expressions in one call. */
	selectRawMany(definitions) {
		for (const def of definitions) this.selectRaw({ [def.alias]: def.expression }, def.bindings);
		return this;
	}
	/** Subquery as a named projected field. */
	selectSub(expression, alias) {
		this.addOperation("selectRaw", { expression: { [alias]: expression } });
		return this;
	}
	/** Alias for selectSub. */
	addSelectSub(expression, alias) {
		return this.selectSub(expression, alias);
	}
	/**
	* Aggregate function as a projected field.
	* @example q.selectAggregate("price", "sum", "totalRevenue")
	*/
	selectAggregate(field, aggregate, alias) {
		return this.selectRaw({ [alias]: `${aggregate.toUpperCase()}(${field})` });
	}
	/** Existence check as a projected boolean field. */
	selectExists(field, alias) {
		return this.selectRaw({ [alias]: `${field} IS NOT NULL` });
	}
	/** COUNT as a projected field. */
	selectCount(field, alias) {
		return this.selectAggregate(field, "count", alias);
	}
	/**
	* CASE / switch expression.
	* @example q.selectCase([{ when: "status = 1", then: "'active'" }], "'inactive'", "statusLabel")
	*/
	selectCase(cases, otherwise, alias) {
		const caseExpr = cases.map((c) => `WHEN ${c.when} THEN ${c.then}`).join(" ");
		return this.selectRaw({ [alias]: `CASE ${caseExpr} ELSE ${otherwise} END` });
	}
	/** IF/ELSE conditional field. */
	selectWhen(condition, thenValue, elseValue, alias) {
		return this.selectRaw({ [alias]: `CASE WHEN ${condition} THEN ${thenValue} ELSE ${elseValue} END` });
	}
	/**
	* Driver-native projection manipulation.
	* No-op in base — override in driver subclasses.
	*/
	selectDriverProjection(_callback) {
		return this;
	}
	/** JSON path extraction as a projected field. */
	selectJson(path, alias) {
		const parts = path.split("->");
		const column = parts[0];
		const jsonPath = parts.slice(1).join("->");
		const expr = jsonPath ? `${column}->>'${jsonPath}'` : column;
		return alias ? this.selectAs(expr, alias) : this.selectRaw(expr);
	}
	/** JSON extraction via raw expression. */
	selectJsonRaw(_path, expression, alias) {
		return this.selectRaw({ [alias]: expression });
	}
	/** Exclude a JSON path from projection. */
	deselectJson(path) {
		return this.deselect([path]);
	}
	/** String concatenation as a projected field. */
	selectConcat(fields, alias) {
		return this.selectRaw({ [alias]: fields.join(" || ") });
	}
	/** COALESCE (first non-null) as a projected field. */
	selectCoalesce(fields, alias) {
		return this.selectRaw({ [alias]: `COALESCE(${fields.join(", ")})` });
	}
	/** Window function expression. */
	selectWindow(spec) {
		this.addOperation("selectRaw", { expression: spec });
		return this;
	}
	/** Exclude specific columns from results. */
	deselect(fields) {
		this.addOperation("deselect", { fields });
		return this;
	}
	/**
	* Remove all select operations (resets to wildcard).
	* Uses `rebuildIndex()` — no unsafe casts.
	*/
	clearSelect() {
		this.operations = this.operations.filter((op) => !op.type.startsWith("select") && op.type !== "deselect");
		this.rebuildIndex();
		return this;
	}
	/** Alias for clearSelect. */
	selectAll() {
		return this.clearSelect();
	}
	/** Alias for clearSelect. */
	selectDefault() {
		return this.clearSelect();
	}
	/** Append additional fields to existing selection. */
	addSelect(fields) {
		this.addOperation("select", {
			fields,
			add: true
		});
		return this;
	}
	/**
	* Record a DISTINCT flag (fluent — does not execute).
	* Subclasses expose a separate async `distinct(field)` execution method.
	*/
	distinctValues(fields) {
		const fieldList = fields ? Array.isArray(fields) ? fields : [fields] : [];
		this.addOperation("distinct", { fields: fieldList });
		return this;
	}
	orderBy(...args) {
		if (typeof args[0] === "string") this.addOperation("orderBy", {
			field: args[0],
			direction: args[1] ?? "asc"
		});
		else for (const [field, direction] of Object.entries(args[0])) this.addOperation("orderBy", {
			field,
			direction
		});
		return this;
	}
	/** ORDER BY descending shorthand. */
	orderByDesc(field) {
		return this.orderBy(field, "desc");
	}
	/**
	* Raw ORDER BY expression.
	* @example q.orderByRaw("RANDOM()")
	* @example q.orderByRaw({ $meta: "textScore" })
	*/
	orderByRaw(expression, bindings) {
		this.addOperation("orderByRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/**
	* Random order. Maps to `RANDOM()` in SQL or `$sample` in MongoDB.
	* @param limit - Optional limit (required for MongoDB $sample)
	*/
	orderByRandom(limit) {
		this.addOperation("orderByRaw", { expression: "RANDOM()" });
		if (limit !== void 0) this.limit(limit);
		return this;
	}
	/** Order ascending by a date column (oldest first). */
	oldest(column = "createdAt") {
		return this.orderBy(column, "asc");
	}
	/** Limit number of results. */
	limit(value) {
		this.addOperation("limit", { value });
		return this;
	}
	/** Skip N results (OFFSET). */
	skip(value) {
		this.addOperation("offset", { value });
		return this;
	}
	/** Alias for skip. */
	offset(value) {
		return this.skip(value);
	}
	/** Alias for limit. */
	take(value) {
		return this.limit(value);
	}
	/**
	* GROUP BY clause.
	* @example q.groupBy("status")
	* @example q.groupBy(["year", "month"])
	*/
	groupBy(input) {
		const fields = Array.isArray(input) ? input : [input];
		this.addOperation("groupBy", { fields });
		return this;
	}
	/** Raw GROUP BY expression. */
	groupByRaw(expression, bindings) {
		this.addOperation("groupBy", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	having(...args) {
		if (args.length === 1) {
			const input = args[0];
			if (Array.isArray(input)) if (input.length === 2) this.addOperation("having", {
				field: input[0],
				operator: "=",
				value: input[1]
			});
			else this.addOperation("having", {
				field: input[0],
				operator: input[1],
				value: input[2]
			});
			else for (const [key, value] of Object.entries(input)) this.addOperation("having", {
				field: key,
				operator: "=",
				value
			});
		} else if (args.length === 2) this.addOperation("having", {
			field: args[0],
			operator: "=",
			value: args[1]
		});
		else this.addOperation("having", {
			field: args[0],
			operator: args[1],
			value: args[2]
		});
		return this;
	}
	/** Raw HAVING expression. */
	havingRaw(expression, bindings) {
		this.addOperation("havingRaw", {
			expression,
			bindings: bindings ?? []
		});
		return this;
	}
	/**
	* Side-effect tap — executes callback synchronously and returns `this`.
	* @example q.where(...).tap(q => console.log(q.operations.length)).limit(10)
	*/
	tap(callback) {
		callback(this);
		return this;
	}
	/**
	* Conditionally apply query modifications.
	*
	* @example
	* q.when(userId, (q, id) => q.where("userId", id))
	* q.when(isAdmin, q => q.withoutGlobalScopes(), q => q.scope("active"))
	*/
	when(condition, callback, otherwise) {
		if (condition) callback(this, condition);
		else if (otherwise) otherwise(this);
		return this;
	}
};
//#endregion
export { QueryBuilder };

//# sourceMappingURL=query-builder.mjs.map