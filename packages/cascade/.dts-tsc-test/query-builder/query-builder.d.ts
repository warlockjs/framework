/**
 * Pure Query Builder Base Class
 *
 * Driver-agnostic operation recorder. All fluent methods push typed entries into
 * `operations[]`. No SQL, no driver references, no table property, no execution.
 *
 * ┌─────────────────────────────────────────────────┐
 * │  Usage contexts                                 │
 * │  (a) Subclassed — PG / Mongo / MySQL / …       │
 * │  (b) Instantiated directly (new QueryBuilder()) │
 * │      inside callbacks for:                      │
 * │      • nested where groups                      │
 * │      • joinWith constraints                     │
 * │      • whereExists / whereHas subqueries        │
 * └─────────────────────────────────────────────────┘
 *
 * Design rules:
 *  - `table` / alias are NOT here — the parser gets them from the executor.
 *  - `opIndex` is protected so subclasses can rebuild after direct mutation.
 *  - Op type names are stable — parsers switch on them; no renaming without
 *    a parser update.
 *  - OR-variants keep distinct op types (orWhere, orWhereColumn, …) so existing
 *    parsers that switch on type need no changes.
 *  - `joinWith` eagerly resolves callbacks → subOps at record time so the
 *    driver executor receives a plain data structure, not a live function.
 *
 * @module cascade/query-builder
 */
import type { GroupByInput, HavingInput, JoinOptions, OrderDirection, RawExpression, WhereCallback, WhereObject, WhereOperator } from "../contracts/query-builder.contract";
/**
 * A single recorded query operation.
 * `type` is the discriminator; `data` carries all parameters.
 */
export type Op = {
    readonly type: string;
    readonly data: Record<string, unknown>;
};
/**
 * Constraint value accepted by `joinWith()`.
 *
 * - `string`  → comma-separated column shorthand: `"id,name,createdAt"`
 * - `fn`      → callback receives a bare QueryBuilder to record sub-ops
 *
 * @example
 * joinWith({ actions: "id,status" })
 * joinWith({ actions: q => q.where("status", "pending").limit(5) })
 */
export type JoinWithConstraint = string | ((q: QueryBuilder) => void);
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
export declare class QueryBuilder<T = unknown> {
    /** Flat, ordered list of recorded operations. Public for parser access. */
    operations: Op[];
    /**
     * type → ordered list of indices into `operations[]`.
     *
     * Protected (not private) so:
     *  - `rebuildIndex()` can reset it after direct `operations[]` mutation.
     *  - Subclasses can inspect it without unsafe casts.
     *
     * External consumers should use `getOps(type)` instead.
     */
    protected opIndex: Map<string, number[]>;
    /** Global scope definitions injected by Model.query(). Keyed by scope name. */
    pendingGlobalScopes?: Map<string, any>;
    /** Local scope callbacks injected by Model.query(). Applied on demand via scope(). */
    availableLocalScopes?: Map<string, (...args: any[]) => void>;
    /** Names of global scopes that have been intentionally disabled. */
    disabledGlobalScopes: Set<string>;
    /** True once the driver subclass has applied pending scopes. */
    scopesApplied: boolean;
    /** Relations to eager-load via separate queries. */
    eagerLoadRelations: Map<string, boolean | ((query: any) => void)>;
    /** Count expressions to emit per result row, keyed by output column alias. */
    countRelations: Map<string, {
        relation: string;
        constraintOps?: Op[];
    }>;
    /** Relation definition map injected from the owning Model. */
    relationDefinitions?: Record<string, any>;
    /** The Model class reference, required for relation resolution. */
    modelClass?: any;
    /**
     * Append an operation to `operations[]` and update `opIndex`.
     * Every fluent method calls this.
     */
    protected addOperation(type: string, data: Record<string, unknown>): void;
    /**
     * Return all recorded operations of the specified types in original
     * insertion order.
     *
     * @example
     * builder.getOps("where", "orWhere", "whereIn")
     */
    getOps(...types: string[]): Op[];
    /**
     * Rebuild `opIndex` from scratch.
     *
     * Call this after any direct mutation of `this.operations[]` (e.g. scope
     * injection, joinWith consumption in the executor, clone post-processing).
     */
    rebuildIndex(): void;
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
    protected subQuery(): QueryBuilder;
    /**
     * Shallow-clone this builder — copies operations, opIndex, and all shared state.
     *
     * Subclasses MUST call `super.clone()` and then copy their own fields
     * (dataSource, joinRelations, …).
     */
    clone(): this;
    /** Disable one or more named global scopes for this query. */
    withoutGlobalScope(...scopeNames: string[]): this;
    /** Disable ALL pending global scopes for this query. */
    withoutGlobalScopes(): this;
    /**
     * Apply a registered local scope by name.
     * @throws if no local scopes are available or the named scope is not found
     */
    scope(scopeName: string, ...args: unknown[]): this;
    /**
     * Add a WHERE clause (AND).
     *
     * @example
     * q.where("status", "active")
     * q.where("age", ">", 18)
     * q.where({ role: "admin", active: true })
     * q.where(q => q.where("a", 1).orWhere("b", 2))
     */
    where(field: string, value: unknown): this;
    where(field: string, operator: WhereOperator, value: unknown): this;
    where(conditions: WhereObject): this;
    where(callback: WhereCallback<T>): this;
    /**
     * Add an OR WHERE clause.
     *
     * @example
     * q.where("role", "admin").orWhere("role", "mod")
     */
    orWhere(field: string, value: unknown): this;
    orWhere(field: string, operator: WhereOperator, value: unknown): this;
    orWhere(conditions: WhereObject): this;
    orWhere(callback: WhereCallback<T>): this;
    /**
     * Raw WHERE expression in the target dialect (AND).
     *
     * @example
     * q.whereRaw("age > ? AND role = ?", [18, "admin"])           // SQL
     * q.whereRaw({ $expr: { $gt: ["$stock", "$reserved"] } })     // MongoDB
     */
    whereRaw(expression: RawExpression, bindings?: unknown[]): this;
    /** Raw OR WHERE expression. */
    orWhereRaw(expression: RawExpression, bindings?: unknown[]): this;
    /**
     * Compare two columns directly (AND).
     * @example q.whereColumn("stock", ">", "reserved")
     */
    whereColumn(first: string, operator: WhereOperator, second: string): this;
    /** Compare two columns directly (OR). */
    orWhereColumn(first: string, operator: WhereOperator, second: string): this;
    /** Compare multiple column pairs in one call. */
    whereColumns(comparisons: Array<[left: string, operator: WhereOperator, right: string]>): this;
    /**
     * Field value must fall between two other column values.
     * Stored as a `whereBetween` op with `useColumns: true` so the SQL parser
     * knows to quote the values as identifiers rather than bind them.
     */
    whereBetweenColumns(field: string, lowerColumn: string, upperColumn: string): this;
    /** WHERE field IN values. */
    whereIn(field: string, values: unknown[]): this;
    /** WHERE field NOT IN values. */
    whereNotIn(field: string, values: unknown[]): this;
    /** WHERE field IS NULL. */
    whereNull(field: string): this;
    /** WHERE field IS NOT NULL. */
    whereNotNull(field: string): this;
    /** WHERE field BETWEEN low AND high. */
    whereBetween(field: string, range: [unknown, unknown]): this;
    /** WHERE field NOT BETWEEN low AND high. */
    whereNotBetween(field: string, range: [unknown, unknown]): this;
    /**
     * LIKE pattern match (AND).
     * @example q.whereLike("email", "%@gmail.com")
     */
    whereLike(field: string, pattern: RegExp | string): this;
    /** NOT LIKE pattern match. */
    whereNotLike(field: string, pattern: RegExp | string): this;
    /** Starts with a prefix. */
    whereStartsWith(field: string, value: string | number): this;
    /** Does NOT start with a prefix. */
    whereNotStartsWith(field: string, value: string | number): this;
    /** Ends with a suffix. */
    whereEndsWith(field: string, value: string | number): this;
    /** Does NOT end with a suffix. */
    whereNotEndsWith(field: string, value: string | number): this;
    /**
     * Match on date portion only (time ignored).
     * @example q.whereDate("createdAt", "2024-05-01")
     */
    whereDate(field: string, value: Date | string): this;
    /** Alias for whereDate. */
    whereDateEquals(field: string, value: Date | string): this;
    /** Field date is before value. */
    whereDateBefore(field: string, value: Date | string): this;
    /** Field date is after value. */
    whereDateAfter(field: string, value: Date | string): this;
    /** Field date is within a range [from, to]. */
    whereDateBetween(field: string, range: [Date | string, Date | string]): this;
    /** Field date is NOT within a range. */
    whereDateNotBetween(field: string, range: [Date | string, Date | string]): this;
    /**
     * Match on the time portion of a datetime field.
     * Emits a `whereRaw` op with a driver-agnostic marker; the driver parser
     * rewrites it to the appropriate SQL (`TIME(field) = ?`) or Mongo expression.
     */
    whereTime(field: string, value: string): this;
    /**
     * Day-of-month from a date field (1–31).
     * Uses a `whereRaw` op so SQL parsers get the `EXTRACT` expression directly.
     * MongoDB drivers override to emit `$dayOfMonth`.
     */
    whereDay(field: string, value: number): this;
    /** Month extracted from a date field (1–12). */
    whereMonth(field: string, value: number): this;
    /** Year extracted from a date field. */
    whereYear(field: string, value: number): this;
    /**
     * JSON/array path contains the given value.
     * @example q.whereJsonContains("tags", "typescript")
     */
    whereJsonContains(path: string, value: unknown): this;
    /** JSON/array path does NOT contain the value. */
    whereJsonDoesntContain(path: string, value: unknown): this;
    /**
     * JSON path key exists.
     * Uses a `whereRaw` so existing SQL parsers get `IS NOT NULL` immediately.
     */
    whereJsonContainsKey(path: string): this;
    /**
     * Constrain the length of a JSON array at a path.
     * @example q.whereJsonLength("tags", ">", 3)
     */
    whereJsonLength(path: string, operator: WhereOperator, value: number): this;
    /** JSON path must resolve to an array. */
    whereJsonIsArray(path: string): this;
    /** JSON path must resolve to an object. */
    whereJsonIsObject(path: string): this;
    /**
     * Constrain the number of elements in an array field.
     * @example q.whereArrayLength("roles", ">=", 2)
     */
    whereArrayLength(field: string, operator: WhereOperator, value: number): this;
    /** WHERE id = value. */
    whereId(value: string | number): this;
    /** WHERE id IN values. */
    whereIds(values: Array<string | number>): this;
    /** WHERE uuid = value. */
    whereUuid(value: string): this;
    /** WHERE ulid = value. */
    whereUlid(value: string): this;
    /**
     * Full-text search across one or more fields.
     * @example q.whereFullText(["title", "body"], "typescript")
     */
    whereFullText(fields: string | string[], query: string): this;
    /** Full-text search (OR). */
    orWhereFullText(fields: string | string[], query: string): this;
    /** Alias for whereFullText with a single field. */
    whereSearch(field: string, query: string): this;
    /**
     * Text search with optional extra equality filters.
     * MongoDB-style convenience shorthand.
     */
    textSearch(query: string, filters?: WhereObject): this;
    /**
     * WHERE EXISTS (subquery callback) or field IS NOT NULL (string).
     *
     * @example
     * q.whereExists(sub => sub.where("userId", "users.id"))
     * q.whereExists("optionalField")
     */
    whereExists(field: string): this;
    whereExists(callback: WhereCallback<T>): this;
    /**
     * WHERE NOT EXISTS (subquery callback) or field IS NULL (string).
     */
    whereNotExists(field: string): this;
    whereNotExists(callback: WhereCallback<T>): this;
    /**
     * Constrain an array/collection field by element count.
     *
     * @example
     * q.whereSize("tags", 3)         // exactly 3
     * q.whereSize("tags", ">=", 1)   // at least 1
     */
    whereSize(field: string, size: number): this;
    whereSize(field: string, operator: WhereOperator, size: number): this;
    /**
     * AND NOT wrapper — negate a nested group.
     * @example q.whereNot(q => q.where("status", "banned").where("role", "user"))
     */
    whereNot(callback: WhereCallback<T>): this;
    /** OR NOT wrapper. */
    orWhereNot(callback: WhereCallback<T>): this;
    /**
     * INNER JOIN.
     * @example q.join("categories", "posts.categoryId", "categories.id")
     */
    join(table: string, localField: string, foreignField: string): this;
    join(options: JoinOptions): this;
    /** LEFT JOIN. */
    leftJoin(table: string, localField: string, foreignField: string): this;
    leftJoin(options: JoinOptions): this;
    /** RIGHT JOIN. */
    rightJoin(table: string, localField: string, foreignField: string): this;
    rightJoin(options: JoinOptions): this;
    /** INNER JOIN (alias for join). */
    innerJoin(table: string, localField: string, foreignField: string): this;
    innerJoin(options: JoinOptions): this;
    /** FULL OUTER JOIN. */
    fullJoin(table: string, localField: string, foreignField: string): this;
    fullJoin(options: JoinOptions): this;
    /** CROSS JOIN. */
    crossJoin(table: string): this;
    /** Raw JOIN expression. Driver responsible for handling. */
    joinRaw(expression: RawExpression, bindings?: unknown[]): this;
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
    joinWith(...args: unknown[]): this;
    /**
     * Eager-load relations via separate queries (N+1 avoided by batching).
     *
     * @example
     * q.with("posts")
     * q.with("posts", q => q.where("published", true))
     * q.with({ posts: true, comments: q => q.limit(5) })
     */
    with(...args: (string | Record<string, boolean | ((q: any) => void)> | ((q: any) => void))[]): this;
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
    withCount(...args: unknown[]): this;
    /**
     * Parse a count spec ("relation" or "relation as alias") into its relation
     * name and output alias, optionally capturing a constraint callback's
     * operations via a sub-builder. Stored in `countRelations` keyed by alias.
     */
    protected recordCountEntry(spec: string, constraint?: (query: any) => void): void;
    /**
     * Split a `"<relation>"` or `"<relation> as <alias>"` spec. Returns the
     * resolved relation name and the output column alias (defaulting to
     * `${relation}Count` when no `as` is present).
     */
    protected parseCountSpec(spec: string): {
        relation: string;
        alias: string;
    };
    /**
     * Filter to rows that have at least one related record.
     * @example q.has("comments")
     * @example q.has("comments", ">=", 3)
     */
    has(relation: string, operator?: WhereOperator, count?: number): this;
    /**
     * Filter to rows with related records matching a sub-query (AND).
     * @example q.whereHas("comments", q => q.where("approved", true))
     */
    whereHas(relation: string, callback: (q: any) => void): this;
    /** Same as whereHas but OR-joined. */
    orWhereHas(relation: string, callback: (q: any) => void): this;
    /** Filter to rows with NO related records. */
    doesntHave(relation: string): this;
    /** Filter to rows with NO related records matching conditions. */
    whereDoesntHave(relation: string, callback: (q: any) => void): this;
    /**
     * Select specific columns.
     *
     * @example
     * q.select(["id", "name"])
     * q.select("id", "name")
     * q.select({ name: 1, password: 0 })   // MongoDB-style projection
     */
    select(fields: string[]): this;
    select(fields: Record<string, 0 | 1 | boolean>): this;
    select(...fields: Array<string | string[]>): this;
    /** Select a field under an alias. @example q.selectAs("fullName", "name") */
    selectAs(field: string, alias: string): this;
    /**
     * Raw SELECT expression.
     * @example q.selectRaw("COUNT(*) AS total")
     */
    selectRaw(expression: RawExpression, bindings?: unknown[]): this;
    /** Multiple raw SELECT expressions in one call. */
    selectRawMany(definitions: Array<{
        alias: string;
        expression: RawExpression;
        bindings?: unknown[];
    }>): this;
    /** Subquery as a named projected field. */
    selectSub(expression: RawExpression, alias: string): this;
    /** Alias for selectSub. */
    addSelectSub(expression: RawExpression, alias: string): this;
    /**
     * Aggregate function as a projected field.
     * @example q.selectAggregate("price", "sum", "totalRevenue")
     */
    selectAggregate(field: string, aggregate: "sum" | "avg" | "min" | "max" | "count" | "first" | "last", alias: string): this;
    /** Existence check as a projected boolean field. */
    selectExists(field: string, alias: string): this;
    /** COUNT as a projected field. */
    selectCount(field: string, alias: string): this;
    /**
     * CASE / switch expression.
     * @example q.selectCase([{ when: "status = 1", then: "'active'" }], "'inactive'", "statusLabel")
     */
    selectCase(cases: Array<{
        when: RawExpression;
        then: RawExpression | unknown;
    }>, otherwise: RawExpression | unknown, alias: string): this;
    /** IF/ELSE conditional field. */
    selectWhen(condition: RawExpression, thenValue: RawExpression | unknown, elseValue: RawExpression | unknown, alias: string): this;
    /**
     * Driver-native projection manipulation.
     * No-op in base — override in driver subclasses.
     */
    selectDriverProjection(_callback: (projection: Record<string, unknown>) => void): this;
    /** JSON path extraction as a projected field. */
    selectJson(path: string, alias?: string): this;
    /** JSON extraction via raw expression. */
    selectJsonRaw(_path: string, expression: RawExpression, alias: string): this;
    /** Exclude a JSON path from projection. */
    deselectJson(path: string): this;
    /** String concatenation as a projected field. */
    selectConcat(fields: Array<string | RawExpression>, alias: string): this;
    /** COALESCE (first non-null) as a projected field. */
    selectCoalesce(fields: Array<string | RawExpression>, alias: string): this;
    /** Window function expression. */
    selectWindow(spec: RawExpression): this;
    /** Exclude specific columns from results. */
    deselect(fields: string[]): this;
    /**
     * Remove all select operations (resets to wildcard).
     * Uses `rebuildIndex()` — no unsafe casts.
     */
    clearSelect(): this;
    /** Alias for clearSelect. */
    selectAll(): this;
    /** Alias for clearSelect. */
    selectDefault(): this;
    /** Append additional fields to existing selection. */
    addSelect(fields: string[]): this;
    /**
     * Record a DISTINCT flag (fluent — does not execute).
     * Subclasses expose a separate async `distinct(field)` execution method.
     */
    distinctValues(fields?: string | string[]): this;
    /**
     * ORDER BY a column.
     *
     * @example
     * q.orderBy("createdAt", "desc")
     * q.orderBy({ name: "asc", age: "desc" })
     */
    orderBy(field: string, direction?: OrderDirection): this;
    orderBy(fields: Record<string, OrderDirection>): this;
    /** ORDER BY descending shorthand. */
    orderByDesc(field: string): this;
    /**
     * Raw ORDER BY expression.
     * @example q.orderByRaw("RANDOM()")
     * @example q.orderByRaw({ $meta: "textScore" })
     */
    orderByRaw(expression: RawExpression, bindings?: unknown[]): this;
    /**
     * Random order. Maps to `RANDOM()` in SQL or `$sample` in MongoDB.
     * @param limit - Optional limit (required for MongoDB $sample)
     */
    orderByRandom(limit?: number): this;
    /** Order ascending by a date column (oldest first). */
    oldest(column?: string): this;
    /** Limit number of results. */
    limit(value: number): this;
    /** Skip N results (OFFSET). */
    skip(value: number): this;
    /** Alias for skip. */
    offset(value: number): this;
    /** Alias for limit. */
    take(value: number): this;
    /**
     * GROUP BY clause.
     * @example q.groupBy("status")
     * @example q.groupBy(["year", "month"])
     */
    groupBy(input: GroupByInput): this;
    /** Raw GROUP BY expression. */
    groupByRaw(expression: RawExpression, bindings?: unknown[]): this;
    /**
     * HAVING clause (post-group filter).
     *
     * @example
     * q.having("total", ">", 100)
     * q.having(["total", ">", 100])
     * q.having({ total: 100 })
     */
    having(field: string, value: unknown): this;
    having(field: string, operator: WhereOperator, value: unknown): this;
    having(condition: HavingInput): this;
    /** Raw HAVING expression. */
    havingRaw(expression: RawExpression, bindings?: unknown[]): this;
    /**
     * Side-effect tap — executes callback synchronously and returns `this`.
     * @example q.where(...).tap(q => console.log(q.operations.length)).limit(10)
     */
    tap(callback: (builder: this) => void): this;
    /**
     * Conditionally apply query modifications.
     *
     * @example
     * q.when(userId, (q, id) => q.where("userId", id))
     * q.when(isAdmin, q => q.withoutGlobalScopes(), q => q.scope("active"))
     */
    when<V>(condition: V | boolean, callback: (builder: this, value: V) => void, otherwise?: (builder: this) => void): this;
}
//# sourceMappingURL=query-builder.d.ts.map