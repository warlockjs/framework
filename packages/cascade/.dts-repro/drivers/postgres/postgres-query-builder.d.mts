import { ChunkCallback, CursorPaginationOptions, CursorPaginationResult, DriverQuery, GroupByInput, PaginationOptions, PaginationResult, QueryBuilderContract, RawExpression } from "../../contracts/query-builder.contract.mjs";
import { DataSource } from "../../data-source/data-source.mjs";
import { ModelRef } from "../../model/register-model.mjs";
import { Op, QueryBuilder } from "../../query-builder/query-builder.mjs";
import { GenericObject } from "@mongez/reinforcements";

//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.d.ts
type JoinRelationConfig = {
  alias: string;
  type: "belongsTo" | "hasOne" | "hasMany";
  model?: ModelRef;
  localKey?: string;
  foreignKey?: string;
  ownerKey?: string;
  parentPath?: string | null;
  relationName?: string;
  parentModel?: ModelRef;
  select?: string[]; /** Operations recorded by a joinWith constraint callback. */
  constraintOps?: Op[];
};
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
declare class PostgresQueryBuilder<T = unknown> extends QueryBuilder<T> implements QueryBuilderContract<T> {
  readonly table: string;
  /** Data source backing this builder. */
  readonly dataSource: DataSource;
  /** Hydration callback for transforming result rows into model instances. */
  hydrateCallback?: (data: unknown, index: number) => unknown;
  /** Invoked before query execution. */
  private fetchingCallback?;
  /** Invoked after fetch but before hydration. */
  private hydratingCallback?;
  /** Invoked after fetch and hydration. */
  private fetchedCallback?;
  /**
   * Map of relations registered via `joinWith()`.
   * Keyed by dot-notation path (e.g. "organizationAiModel.aiModel").
   */
  joinRelations: Map<string, JoinRelationConfig>;
  /**
   * Idempotency guard for `applyJoinRelations()` so calling `parse()` then
   * `get()` (or `parse()` twice) doesn't double-emit `selectRelatedColumns`
   * operations.
   */
  private joinRelationsApplied;
  /**
   * Idempotency guard for `applyCountRelations()` — see `joinRelationsApplied`.
   */
  private countRelationsApplied;
  /**
   * Idempotency guard for `applyHasRelations()` — see `joinRelationsApplied`.
   */
  private hasRelationsApplied;
  /**
   * Alias → SQL expression for two-arg `groupBy` aggregates. Recorded by the
   * `groupBy` override; consumed by `applyGroupByAggregates` to rewrite a
   * `having()` on the alias into the underlying expression (Postgres forbids
   * SELECT aliases in HAVING).
   */
  private aggregateAliases;
  /**
   * Idempotency guard for `applyGroupByAggregates()` — see `joinRelationsApplied`.
   */
  private groupByAggregatesApplied;
  /**
   * @param table - Target table name
   * @param dataSource - Optional (uses default data source from registry if omitted)
   */
  constructor(table: string, dataSource?: DataSource);
  private get driver();
  clone(): this;
  /**
   * Native-query escape hatch. Passes `operations[]` to the callback for
   * direct manipulation. Use sparingly — only when fluent API is insufficient.
   *
   * @example
   * q.raw(ops => ops.push({ type: "whereRaw", data: { expression: "1=1" } }))
   */
  raw(callback: (operations: Op[]) => void): this;
  /**
   * Record a DISTINCT flag AND auto-select the field(s).
   * In PostgreSQL, DISTINCT ON (col) requires the col to appear in SELECT.
   *
   * @example
   * q.distinctValues("category")               // SELECT category … DISTINCT ON (category)
   * q.distinctValues(["category", "status"])   // both fields in DISTINCT ON and SELECT
   */
  distinctValues(fields?: string | string[]): this;
  /**
   * GROUP BY with computed aggregates.
   *
   * Single-arg form defers to the base builder. With `aggregates`, each entry
   * is translated to SQL — via the dialect for `$agg.*` helpers, verbatim for
   * a raw SQL string — and pushed through the proven `selectRaw` projection
   * (the same plumbing `similarTo` / `applyCountRelations` rely on). The
   * grouped columns are projected explicitly because `SELECT *` is invalid
   * alongside `GROUP BY`. The alias → expression map is recorded so
   * `applyGroupByAggregates` can later rewrite `having()` on the alias.
   *
   * `$agg.distinct/floor/first/last` throw (MongoDB-only on Postgres v1);
   * MongoDB operator objects throw (not portable to SQL).
   *
   * @example
   * Order.query().groupBy("category", {
   *   orders: $agg.count(),
   *   revenue: $agg.sum("amount"),
   * }).having("revenue", ">", 1000);
   */
  groupBy(fields: GroupByInput): this;
  groupBy(fields: GroupByInput, aggregates: Record<string, RawExpression>): this;
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
  similarTo(column: string, embedding: number[], alias?: string): this;
  /** Set a hydration callback that transforms each result row. */
  hydrate(callback: (data: unknown, index: number) => unknown): this;
  /** Register a callback invoked before query execution. */
  onFetching(callback: (query: this) => void | Promise<void>): () => void;
  /** Register a callback invoked after fetch but before hydration. */
  onHydrating(callback: (records: unknown[], context: unknown) => void | Promise<void>): () => void;
  /** Register a callback invoked after fetch and hydration. */
  onFetched(callback: (records: unknown[], context: unknown) => void | Promise<void>): () => void;
  /** Apply pending global scopes to the operations list. */
  private applyPendingScopes;
  /** Array field contains a value (or object with key). */
  whereArrayContains(field: string, value: unknown, key?: string): this;
  /** Array field does NOT contain a value (or object with key). */
  whereArrayNotContains(field: string, value: unknown, key?: string): this;
  /** Array field contains value OR is empty. */
  whereArrayHasOrEmpty(field: string, value: unknown, key?: string): this;
  /** Array field does NOT contain value OR is empty. */
  whereArrayNotHaveOrEmpty(field: string, value: unknown, key?: string): this;
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
  joinWith(...args: unknown[]): this;
  /** Run a joinWith constraint callback against a sub-QB and capture its operations. */
  private _resolveConstraintOps;
  /**
   * Execute the query and return all matching rows.
   */
  get<TResult = T>(): Promise<TResult[]>;
  /** Get first result. */
  first<TResult = T>(): Promise<TResult | null>;
  /** Get last result (by id desc). */
  last<TResult = T>(): Promise<TResult | null>;
  /** Get random results. */
  random<TResult = T>(limit?: number): Promise<TResult[]>;
  /** Get first or throw. */
  firstOrFail<TResult = T>(): Promise<TResult>;
  /** Get first or call callback. */
  firstOr<TResult = T>(callback: () => TResult | Promise<TResult>): Promise<TResult>;
  /** Get first or return null. */
  firstOrNull<TResult = T>(): Promise<TResult | null>;
  /** Get first or return default. */
  firstOrNew<TResult = T>(defaults: GenericObject): Promise<TResult>;
  /** Find by primary key. */
  find<TResult = T>(id: number | string): Promise<TResult | null>;
  /** Count matching rows. */
  count(): Promise<number>;
  /** SUM a numeric field. */
  sum(field: string): Promise<number>;
  /** AVG of a numeric field. */
  avg(field: string): Promise<number>;
  /** MIN of a numeric field. */
  min(field: string): Promise<number>;
  /** MAX of a numeric field. */
  max(field: string): Promise<number>;
  /** Get distinct values for a field. */
  distinct<TResult = unknown>(field: string): Promise<TResult[]>;
  /** Get array of all values for a single field. */
  pluck(field: string): Promise<unknown[]>;
  /** Get a single scalar value. */
  value<TResult = unknown>(field: string): Promise<TResult | null>;
  /** Check whether any matching rows exist. */
  exists(): Promise<boolean>;
  /** Check whether NO matching rows exist. */
  notExists(): Promise<boolean>;
  /** COUNT DISTINCT a field. */
  countDistinct(field: string): Promise<number>;
  /** Get latest records ordered by a column. */
  latest(column?: string): Promise<T[]>;
  /** Increment a numeric field. Returns new value. */
  increment(field: string, amount?: number): Promise<number>;
  /** Decrement a numeric field. Returns new value. */
  decrement(field: string, amount?: number): Promise<number>;
  /** Increment a field for all matching rows. Returns affected row count. */
  incrementMany(field: string, amount?: number): Promise<number>;
  /** Decrement a field for all matching rows. Returns affected row count. */
  decrementMany(field: string, amount?: number): Promise<number>;
  /**
   * Process results in memory-efficient chunks.
   *
   * @example
   * await User.query().chunk(100, async (rows, idx) => { ... })
   */
  chunk(size: number, callback: ChunkCallback<T>): Promise<void>;
  /** Page-based pagination. */
  paginate(options?: PaginationOptions): Promise<PaginationResult<T>>;
  /**
   * Set cursor pagination hints fluently.
   * The recorded values are picked up by `cursorPaginate()` when no explicit
   * options are passed.
   *
   * @example
   * User.query().cursor(lastId).cursorPaginate({ limit: 20 })
   */
  cursor(after?: unknown, before?: unknown): this;
  /** Cursor-based pagination. */
  cursorPaginate(options?: CursorPaginationOptions): Promise<CursorPaginationResult<T>>;
  /** Delete matching rows. Returns deleted count. */
  delete(): Promise<number>;
  /** Delete the first matching row. */
  deleteOne(): Promise<number>;
  /** Update matching rows. */
  update(fields: Record<string, unknown>): Promise<number>;
  /** Unset fields from matching rows. */
  unset(...fields: string[]): Promise<number>;
  /**
   * Return the SQL + bindings without executing.
   *
   * Runs the same prelude as `get()` (scopes, joinWith expansion, joinRelations,
   * countRelations) so the preview matches what would actually be sent to the
   * database. The apply* methods are idempotent — calling `parse()` then `get()`
   * does not double-emit operations.
   */
  parse(): DriverQuery;
  /** Formatted SQL string (for logging/debugging). */
  pretty(): string;
  /** Run EXPLAIN ANALYZE on the query. */
  explain(): Promise<unknown>;
  /** Extend the builder with a driver-specific extension. */
  extend<R>(extension: string, ..._args: unknown[]): R;
  /** Pluck scalar values for a single field (alias for pluck). */
  pluckOne<TResult = unknown>(field: string): Promise<TResult[]>;
  /**
   * Before `get()` runs the parser, consume any joinWith ops recorded by the base
   * class and expand them into the joinRelations Map.
   */
  private _processJoinWithOps;
  /**
   * Translate each entry in `joinRelations` into actual JOIN + selectRelatedColumns operations.
   *
   * Idempotent — guarded by `joinRelationsApplied` so repeat calls (e.g.
   * `parse()` followed by `get()`) don't double-emit operations.
   */
  private applyJoinRelations;
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
  private applyHasRelations;
  /**
   * Translate one has-family operation into its `whereRaw`/`orWhereRaw`
   * equivalent. Resolves the relation definition, builds the EXISTS or
   * COUNT-comparison subquery, and returns the replacement op.
   */
  private translateHasOp;
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
  private buildHasSubquery;
  /**
   * Translate each entry in `countRelations` into a correlated COUNT subquery
   * emitted as a `selectRaw` operation. Runs after `applyJoinRelations` so the
   * "preserve main table columns" guard sees any joins already in place.
   *
   * Idempotent — guarded by `countRelationsApplied` so repeat calls (e.g.
   * `parse()` followed by `get()`) don't double-emit operations.
   */
  private applyCountRelations;
  /**
   * Without an explicit `select(...)` or any `selectRaw`/`selectRelatedColumns`
   * already pushed, the parser's "no selects → SELECT *" fallback would be
   * suppressed once we add count expressions. Push `<table>.*` first so the
   * caller's columns survive.
   */
  private ensureMainColumnsForCount;
  /**
   * Build a single correlated-subquery expression for a count entry. Branches
   * on relation type (hasMany/hasOne/belongsTo/belongsToMany). The optional
   * constraint callback's where-ops are translated via a sub-parser and
   * spliced into the subquery's WHERE clause.
   */
  private buildCountSubquery;
  /**
   * Run a constraint's where-ops through a fresh sub-parser to obtain a SQL
   * WHERE-fragment plus bindings. Strips the leading `WHERE ` and rewrites
   * `$N` placeholders back to `?` so the outer parser renumbers them
   * consistently when it processes the enclosing `selectRaw` operation.
   *
   * Non-where ops (orderBy / limit / etc.) are silently dropped — they have
   * no meaning inside a COUNT subquery.
   */
  private extractCountWhereFragment;
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
  private applyGroupByAggregates;
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
  private applyEagerLoading;
  /**
   * Extract per-relation data from raw DB rows (before hydration).
   * Returns a Map of row index → nested relation data tree.
   */
  private extractJoinedRelationData;
  /**
   * Attach extracted relation data to hydrated model instances.
   */
  private attachJoinedRelations;
  /**
   * Build a WHERE-only SQL fragment from `where*` operations on the current builder.
   * Used by DELETE / UPDATE / increment paths.
   */
  private buildFilter;
}
//#endregion
export { PostgresQueryBuilder };
//# sourceMappingURL=postgres-query-builder.d.mts.map