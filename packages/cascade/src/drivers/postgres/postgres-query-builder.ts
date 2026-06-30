/**
 * PostgreSQL Query Builder
 *
 * Extends the pure QueryBuilder base with PostgreSQL-specific execution,
 * SQL generation, relation hydration, and scope management.
 *
 * @module cascade/drivers/postgres
 */

import type { GenericObject } from "@mongez/reinforcements";
import type {
  ChunkCallback,
  CursorPaginationOptions,
  CursorPaginationResult,
  DriverQuery,
  GroupByInput,
  PaginationOptions,
  PaginationResult,
  QueryBuilderContract,
  RawExpression,
} from "../../contracts/query-builder.contract";
import type { DataSource } from "../../data-source/data-source";
import { dataSourceRegistry } from "../../data-source/data-source-registry";
import { isAggregateExpression } from "../../expressions";
import type { GlobalScopeDefinition } from "../../model/model";
import { resolveModelClass, tryResolveModelClass, type ModelRef } from "../../model/register-model";
import { QueryBuilder, type Op } from "../../query-builder/query-builder";
import {
  inferBelongsToForeignKey,
  inferHasForeignKey,
  inferPivotKey,
  inferPivotTable,
} from "../../relations/key-conventions";
import { attachLoadedRelation, RelationLoader } from "../../relations/relation-loader";
import type { PostgresDriver } from "./postgres-driver";
import { PostgresQueryParser, type PostgresParserOperation } from "./postgres-query-parser";

// ============================================================================
// HELPER
// ============================================================================

/**
 * Cast an Op[] to PostgresParserOperation[] — the shapes are compatible since
 * both have `type: string` and `data: Record<string, unknown>`.
 */
function toParserOps(ops: Op[]): PostgresParserOperation[] {
  return ops as unknown as PostgresParserOperation[];
}

// ============================================================================
// JOIN RELATIONS MAP TYPE
// ============================================================================

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
  select?: string[];
  /** Operations recorded by a joinWith constraint callback. */
  constraintOps?: Op[];
};

// ============================================================================
// POSTGRES QUERY BUILDER
// ============================================================================

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
export class PostgresQueryBuilder<T = unknown>
  extends QueryBuilder<T>
  implements QueryBuilderContract<T>
{
  // ──────────────────────────────────────────────────────────────
  // POSTGRES-SPECIFIC STATE
  // ──────────────────────────────────────────────────────────────

  /** Data source backing this builder. */
  public readonly dataSource: DataSource;

  /** Hydration callback for transforming result rows into model instances. */
  public hydrateCallback?: (data: unknown, index: number) => unknown;

  /** Invoked before query execution. */
  private fetchingCallback?: (query: this) => void | Promise<void>;

  /** Invoked after fetch but before hydration. */
  private hydratingCallback?: (records: unknown[], context: unknown) => void | Promise<void>;

  /** Invoked after fetch and hydration. */
  private fetchedCallback?: (records: unknown[], context: unknown) => void | Promise<void>;

  /**
   * Map of relations registered via `joinWith()`.
   * Keyed by dot-notation path (e.g. "organizationAiModel.aiModel").
   */
  public joinRelations = new Map<string, JoinRelationConfig>();

  /**
   * Idempotency guard for `applyJoinRelations()` so calling `parse()` then
   * `get()` (or `parse()` twice) doesn't double-emit `selectRelatedColumns`
   * operations.
   */
  private joinRelationsApplied = false;

  /**
   * Idempotency guard for `applyCountRelations()` — see `joinRelationsApplied`.
   */
  private countRelationsApplied = false;

  /**
   * Idempotency guard for `applyHasRelations()` — see `joinRelationsApplied`.
   */
  private hasRelationsApplied = false;

  /**
   * Alias → SQL expression for two-arg `groupBy` aggregates. Recorded by the
   * `groupBy` override; consumed by `applyGroupByAggregates` to rewrite a
   * `having()` on the alias into the underlying expression (Postgres forbids
   * SELECT aliases in HAVING).
   */
  private aggregateAliases = new Map<string, string>();

  /**
   * Idempotency guard for `applyGroupByAggregates()` — see `joinRelationsApplied`.
   */
  private groupByAggregatesApplied = false;

  // ──────────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ──────────────────────────────────────────────────────────────

  /**
   * @param table - Target table name
   * @param dataSource - Optional (uses default data source from registry if omitted)
   */
  public constructor(
    public readonly table: string,
    dataSource?: DataSource,
  ) {
    super();
    this.dataSource = dataSource ?? dataSourceRegistry.get()!;
  }

  // ──────────────────────────────────────────────────────────────
  // DRIVER
  // ──────────────────────────────────────────────────────────────

  private get driver(): PostgresDriver {
    return this.dataSource.driver as PostgresDriver;
  }

  // ──────────────────────────────────────────────────────────────
  // CLONE
  // ──────────────────────────────────────────────────────────────

  public clone(): this {
    const cloned = new PostgresQueryBuilder<T>(this.table, this.dataSource) as this;

    // Copy base-class state
    cloned.operations = [...this.operations];
    cloned.pendingGlobalScopes = this.pendingGlobalScopes;
    cloned.availableLocalScopes = this.availableLocalScopes;
    cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
    cloned.scopesApplied = this.scopesApplied;
    cloned.eagerLoadRelations = new Map(this.eagerLoadRelations);
    cloned.countRelations = new Map(this.countRelations);
    cloned.relationDefinitions = this.relationDefinitions;
    cloned.modelClass = this.modelClass;

    // Copy PG-specific state
    cloned.hydrateCallback = this.hydrateCallback;
    cloned.joinRelations = new Map(this.joinRelations);
    cloned.joinRelationsApplied = this.joinRelationsApplied;
    cloned.countRelationsApplied = this.countRelationsApplied;
    cloned.hasRelationsApplied = this.hasRelationsApplied;
    cloned.aggregateAliases = new Map(this.aggregateAliases);
    cloned.groupByAggregatesApplied = this.groupByAggregatesApplied;

    return cloned;
  }

  // ============================================================================
  // PG-SPECIFIC FLUENT METHODS
  // ============================================================================

  /**
   * Native-query escape hatch. Passes `operations[]` to the callback for
   * direct manipulation. Use sparingly — only when fluent API is insufficient.
   *
   * @example
   * q.raw(ops => ops.push({ type: "whereRaw", data: { expression: "1=1" } }))
   */
  public raw(callback: (operations: Op[]) => void): this {
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
  public override distinctValues(fields?: string | string[]): this {
    // Record the base DISTINCT flag op
    super.distinctValues(fields);
    // Also add a select for the field(s) so they appear in the SELECT clause
    if (fields) {
      const fieldArr = Array.isArray(fields) ? fields : [fields];
      this.addOperation("select", { fields: fieldArr });
    }
    return this;
  }

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
  public groupBy(fields: GroupByInput): this;
  public groupBy(fields: GroupByInput, aggregates: Record<string, RawExpression>): this;
  public groupBy(fields: GroupByInput, aggregates?: Record<string, RawExpression>): this {
    if (!aggregates) {
      return super.groupBy(fields);
    }

    const fieldList = Array.isArray(fields) ? fields : [fields];

    this.addOperation("select", { fields: fieldList });

    this.projectGroupAggregates(aggregates);

    return super.groupBy(fields);
  }

  /**
   * Portable date-bucketed GROUP BY.
   *
   * Truncates `column` to the given bucket (`day` / `week` / `month` / `year`)
   * via PostgreSQL's `date_trunc`, projects the bucket under the column's own
   * name, and groups by the truncated expression. Optional `aggregates` follow
   * the same rules as the two-arg `groupBy` (`$agg.*` helpers or raw SQL
   * strings; MongoDB operator objects and MongoDB-only aggregates throw).
   *
   * Emits (for `groupByDate("created_at", "month", { revenue: $agg.sum(...) })`):
   * `SELECT date_trunc('month', "created_at") AS "created_at", SUM(...) AS "revenue"
   *  FROM ... GROUP BY date_trunc('month', "created_at")`
   *
   * @param column - The date/timestamp column to bucket
   * @param unit - The bucket granularity
   * @param aggregates - Optional aggregate projections keyed by output alias
   *
   * @example
   * Order.query().groupByDate("created_at", "month", {
   *   revenue: $agg.sum($expr.mul("price", "quantity")),
   * });
   */
  public groupByDate(
    column: string,
    unit: "day" | "week" | "month" | "year",
    aggregates?: Record<string, RawExpression>,
  ): this {
    const bucketSql = this.driver.dialect.dateTruncSql(column, unit);

    // Project the bucket under the column's own name so the result row carries
    // it (SELECT * is invalid alongside GROUP BY).
    this.addOperation("selectRaw", {
      expression: `${bucketSql} AS ${this.driver.dialect.quoteIdentifier(column)}`,
      bindings: [],
    });

    if (aggregates) {
      this.projectGroupAggregates(aggregates);
    }

    // GROUP BY the raw bucket expression (not the column alias).
    this.addOperation("groupByRaw", { expression: bucketSql, bindings: [] });

    return this;
  }

  /**
   * Translate a `{ alias: aggregate }` map into `selectRaw` projections and
   * record each alias → SQL so `applyGroupByAggregates` can later rewrite a
   * `having()` on the alias. Shared by `groupBy` and `groupByDate`.
   *
   * `$agg.distinct/floor/first/last` throw (MongoDB-only on Postgres v1);
   * MongoDB operator objects throw (not portable to SQL).
   */
  private projectGroupAggregates(aggregates: Record<string, RawExpression>): void {
    for (const [alias, expression] of Object.entries(aggregates)) {
      let sql: string;

      if (isAggregateExpression(expression)) {
        sql = this.driver.dialect.aggregateToSql(expression);
      } else if (typeof expression === "string") {
        sql = expression;
      } else {
        throw new Error(
          `groupBy aggregate "${alias}" must be a $agg.* helper or a raw SQL ` +
            `string on Postgres; got ${typeof expression}. MongoDB operator ` +
            `objects are not portable to SQL — use selectRaw with explicit SQL.`,
        );
      }

      this.aggregateAliases.set(alias, sql);

      this.addOperation("selectRaw", {
        expression: `${sql} AS ${this.driver.dialect.quoteIdentifier(alias)}`,
        bindings: [],
      });
    }
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
  public similarTo(column: string, embedding: number[], alias = "score"): this {
    // pgvector expects the literal format: [n,n,n,...]
    const literal = `[${embedding.join(",")}]`;
    const quotedCol = this.driver.dialect.quoteIdentifier(column);
    const quotedTable = this.driver.dialect.quoteIdentifier(this.table);

    // 0 — Preserve all table columns.
    //     Adding a selectRaw suppresses the parser's "SELECT *" fallback,
    //     so we must explicitly include table.* before the score expression.
    this.addOperation("selectRaw", {
      expression: `${quotedTable}.*`,
      bindings: [],
    });

    // 1 — Add similarity score to SELECT
    this.addOperation("selectRaw", {
      expression: `1 - (${quotedCol} <=> ?::vector) AS ${alias}`,
      bindings: [literal],
    });

    // 2 — ORDER BY the raw expression so the vector index is used
    this.addOperation("orderByRaw", {
      expression: `${quotedCol} <=> ?::vector`,
      bindings: [literal],
    });

    return this;
  }

  /** Set a hydration callback that transforms each result row. */
  public hydrate(callback: (data: unknown, index: number) => unknown): this {
    this.hydrateCallback = callback;
    return this;
  }

  /** Register a callback invoked before query execution. */
  public onFetching(callback: (query: this) => void | Promise<void>): () => void {
    this.fetchingCallback = callback;
    return () => {
      this.fetchingCallback = undefined;
    };
  }

  /** Register a callback invoked after fetch but before hydration. */
  public onHydrating(
    callback: (records: unknown[], context: unknown) => void | Promise<void>,
  ): () => void {
    this.hydratingCallback = callback;
    return () => {
      this.hydratingCallback = undefined;
    };
  }

  /** Register a callback invoked after fetch and hydration. */
  public onFetched(
    callback: (records: unknown[], context: unknown) => void | Promise<void>,
  ): () => void {
    this.fetchedCallback = callback;
    return () => {
      this.fetchedCallback = undefined;
    };
  }

  // ============================================================================
  // SCOPES
  // ============================================================================

  /** Apply pending global scopes to the operations list. */
  private applyPendingScopes(): void {
    if (!this.pendingGlobalScopes || this.scopesApplied) return;

    const beforeOps: Op[] = [];
    const afterOps: Op[] = [];

    for (const [name, { callback, timing }] of this.pendingGlobalScopes as Map<
      string,
      GlobalScopeDefinition
    >) {
      if (this.disabledGlobalScopes.has(name)) continue;

      const temp = new PostgresQueryBuilder(this.table, this.dataSource);
      callback(temp as unknown as QueryBuilderContract<T>);

      if (timing === "before") {
        beforeOps.push(...temp.operations);
      } else {
        afterOps.push(...temp.operations);
      }
    }

    this.operations = [...beforeOps, ...this.operations, ...afterOps];
    this.scopesApplied = true;
  }

  // ============================================================================
  // WHERE — POSTGRES-SPECIFIC (driver.dialect required)
  // ============================================================================

  /** Array field contains a value (or object with key). */
  public whereArrayContains(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `${quotedField} @> ?::jsonb`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `? = ANY(${quotedField})`,
        bindings: [value],
      });
    }
    return this;
  }

  /** Array field does NOT contain a value (or object with key). */
  public whereArrayNotContains(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `NOT (${quotedField} @> ?::jsonb)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `NOT (? = ANY(${quotedField}))`,
        bindings: [value],
      });
    }
    return this;
  }

  /** Array field contains value OR is empty. */
  public whereArrayHasOrEmpty(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `(${quotedField} @> ?::jsonb OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `(? = ANY(${quotedField}) OR array_length(${quotedField}, 1) IS NULL)`,
        bindings: [value],
      });
    }
    return this;
  }

  /** Array field does NOT contain value OR is empty. */
  public whereArrayNotHaveOrEmpty(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `(NOT (${quotedField} @> ?::jsonb) OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `(NOT (? = ANY(${quotedField})) OR array_length(${quotedField}, 1) IS NULL)`,
        bindings: [value],
      });
    }
    return this;
  }

  // ============================================================================
  // joinWith — RESOLVE RELATION DEFINITIONS
  // ============================================================================

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
  public override joinWith(...args: unknown[]): this {
    // Normalise all args into an array of { path, constraint } pairs
    type Entry = { path: string; constraint?: string | ((q: QueryBuilder) => void) };
    const entries: Entry[] = [];

    for (const arg of args) {
      if (typeof arg === "string") {
        entries.push({ path: arg });
      } else if (Array.isArray(arg)) {
        for (const rel of arg) {
          entries.push({ path: rel });
        }
      } else if (typeof arg === "object" && arg !== null) {
        for (const [rel, val] of Object.entries(arg)) {
          entries.push({ path: rel, constraint: val });
        }
      }
    }

    for (const { path, constraint } of entries) {
      // Parse each dot-notation path segment (supports "rel1.rel2" nesting)
      const segments = path.split(".");
      let currentModel: unknown = this.modelClass;
      let currentPath = "";

      for (let i = 0; i < segments.length; i++) {
        const rawSeg = segments[i];
        // String shorthand: "relName:col1,col2"
        const colonIdx = rawSeg.indexOf(":");
        const segName = colonIdx === -1 ? rawSeg : rawSeg.slice(0, colonIdx);
        const segColumns =
          colonIdx === -1
            ? undefined
            : rawSeg
                .slice(colonIdx + 1)
                .split(",")
                .filter(Boolean);

        currentPath = currentPath ? `${currentPath}.${segName}` : segName;

        // If already registered, update if new select columns given; advance model
        if (this.joinRelations.has(currentPath)) {
          const existing = this.joinRelations.get(currentPath)!;
          if (segColumns) existing.select = segColumns;

          // Apply constraint only on the deepest segment
          if (i === segments.length - 1 && constraint !== undefined) {
            existing.constraintOps = this._resolveConstraintOps(constraint);
          }

          currentModel = tryResolveModelClass(existing.model);
          continue;
        }

        if (!this.relationDefinitions) continue;

        const def = (
          i === 0
            ? (this.relationDefinitions as Record<string, unknown>)
            : (currentModel as { relations?: Record<string, unknown> })?.relations
        )?.[segName] as Record<string, unknown> | undefined;

        if (!def) {
          throw new Error(
            `Relation "${segName}" not found on model ${(currentModel as { name?: string })?.name ?? "unknown"}`,
          );
        }

        // Resolve select columns: colon shorthand > constraint string > def.select
        let selectColumns: string[] | undefined =
          segColumns ?? (def.select as string[] | undefined);

        let constraintOps: Op[] | undefined;
        if (i === segments.length - 1 && constraint !== undefined) {
          if (typeof constraint === "string") {
            selectColumns = constraint.split(",").filter(Boolean);
          } else {
            constraintOps = this._resolveConstraintOps(constraint);
          }
        }

        const alias = currentPath.replace(/\./g, "_");

        this.joinRelations.set(currentPath, {
          alias,
          type: def.type as JoinRelationConfig["type"],
          model: def.model as ModelRef | undefined,
          localKey: def.localKey as string | undefined,
          foreignKey: def.foreignKey as string | undefined,
          ownerKey: def.ownerKey as string | undefined,
          parentPath: i > 0 ? currentPath.substring(0, currentPath.lastIndexOf(".")) : null,
          relationName: segName,
          parentModel: currentModel as ModelRef | undefined,
          select: selectColumns,
          constraintOps,
        });

        currentModel = tryResolveModelClass(def.model as ModelRef | undefined);

        if (!currentModel) {
          throw new Error(`Relation model not found for "${segName}" in "${currentPath}"`);
        }
      }
    }

    return this;
  }

  /** Run a joinWith constraint callback against a sub-QB and capture its operations. */
  private _resolveConstraintOps(constraint: string | ((q: QueryBuilder) => void)): Op[] {
    if (typeof constraint === "string") return [];
    const sub = new PostgresQueryBuilder("__sub__", this.dataSource);
    constraint(sub);
    return sub.operations;
  }

  // ============================================================================
  // EXECUTION METHODS
  // ============================================================================

  /**
   * Execute the query and return all matching rows.
   */
  public async get<TResult = T>(): Promise<TResult[]> {
    this.applyPendingScopes();
    this._processJoinWithOps();
    this.applyJoinRelations();
    this.applyHasRelations();
    this.applyCountRelations();
    this.applyGroupByAggregates();

    if (this.fetchingCallback) {
      await this.fetchingCallback(this);
    }

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: toParserOps(this.operations),
    });

    const { query = "", bindings = [] } = parser.parse();

    try {
      const result = await this.driver.query<TResult>(query, bindings);
      let records = result.rows;

      const joinedData = this.extractJoinedRelationData(records);

      if (this.hydratingCallback) {
        await this.hydratingCallback(records as unknown[], {});
      }

      if (this.hydrateCallback) {
        records = records.map((row, index) => this.hydrateCallback!(row, index)) as TResult[];
      }

      this.attachJoinedRelations(records, joinedData);

      await this.applyEagerLoading(records as unknown[]);

      if (this.fetchedCallback) {
        await this.fetchedCallback(records as unknown[], {});
      }

      this.operations = [];
      return records;
    } catch (error) {
      console.log("Error while executing:", query, bindings);
      console.log("Query Builder Error:", error);
      throw error;
    }
  }

  /** Get first result. */
  public async first<TResult = T>(): Promise<TResult | null> {
    const results = await this.limit(1).get<TResult>();
    return results[0] ?? null;
  }

  /** Get last result (by id desc). */
  public async last<TResult = T>(): Promise<TResult | null> {
    const results = await this.orderByDesc("id").limit(1).get<TResult>();
    return results[0] ?? null;
  }

  /** Get random results. */
  public async random<TResult = T>(limit?: number): Promise<TResult[]> {
    this.orderByRaw("RANDOM()");
    if (limit) this.limit(limit);
    return this.get<TResult>();
  }

  /** Get first or throw. */
  public async firstOrFail<TResult = T>(): Promise<TResult> {
    const result = await this.first<TResult>();
    if (!result) throw new Error("No records found");
    return result;
  }

  /** Get first or call callback. */
  public async firstOr<TResult = T>(callback: () => TResult | Promise<TResult>): Promise<TResult> {
    const result = await this.first<TResult>();
    return result ?? (await callback());
  }

  /** Get first or return null. */
  public async firstOrNull<TResult = T>(): Promise<TResult | null> {
    return this.first<TResult>();
  }

  /** Get first or return default. */
  public async firstOrNew<TResult = T>(defaults: GenericObject): Promise<TResult> {
    const result = await this.first<TResult>();
    return result ?? (defaults as unknown as TResult);
  }

  /** Find by primary key. */
  public async find<TResult = T>(id: number | string): Promise<TResult | null> {
    return this.where("id", id).first<TResult>();
  }

  /** Count matching rows. */
  public async count(): Promise<number> {
    this.applyPendingScopes();
    const countOps: PostgresParserOperation[] = toParserOps([
      ...this.operations.filter((op) => op.type.includes("where") || op.type.includes("join")),
      { type: "selectRaw", data: { expression: 'COUNT(*) AS "count"' } },
    ]);

    const parser = new PostgresQueryParser({ table: this.table, operations: countOps });
    const { query = "", bindings = [] } = parser.parse();
    const result = await this.driver.query<{ count: string }>(query, bindings);
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  /** SUM a numeric field. */
  public async sum(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`SUM(${field}) as sum`).first<{ sum: string }>();
    return parseFloat(result?.sum ?? "0");
  }

  /** AVG of a numeric field. */
  public async avg(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`AVG(${field}) as avg`).first<{ avg: string }>();
    return parseFloat(result?.avg ?? "0");
  }

  /** MIN of a numeric field. */
  public async min(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`MIN(${field}) as min`).first<{ min: string }>();
    return parseFloat(result?.min ?? "0");
  }

  /** MAX of a numeric field. */
  public async max(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`MAX(${field}) as max`).first<{ max: string }>();
    return parseFloat(result?.max ?? "0");
  }

  /** Get distinct values for a field. */
  public async distinct<TResult = unknown>(field: string): Promise<TResult[]> {
    this.distinctValues(field);
    const results = await this.get<{ [key: string]: TResult }>();
    return results.map((row) => row[field]);
  }

  /** Get array of all values for a single field. */
  public async pluck(field: string): Promise<unknown[]> {
    const results = await this.select([field]).get<Record<string, unknown>>();
    return results.map((row) => row[field]);
  }

  /** Get a single scalar value. */
  public async value<TResult = unknown>(field: string): Promise<TResult | null> {
    const result = await this.select([field]).first<Record<string, TResult>>();
    return result?.[field] ?? null;
  }

  /** Check whether any matching rows exist. */
  public async exists(): Promise<boolean> {
    const count = await this.limit(1).count();
    return count > 0;
  }

  /** Check whether NO matching rows exist. */
  public async notExists(): Promise<boolean> {
    return !(await this.exists());
  }

  /** COUNT DISTINCT a field. */
  public async countDistinct(field: string): Promise<number> {
    const result = await this.selectRaw(`COUNT(DISTINCT ${field}) as count`).first<{
      count: string;
    }>();
    return parseInt(result?.count ?? "0", 10);
  }

  // ─── Aggregation shortcuts via latest/oldest ─────────────────

  /** Get latest records ordered by a column. */
  public async latest(column = "createdAt"): Promise<T[]> {
    return this.orderBy(column, "desc").get();
  }

  // ─── Increment / Decrement ───────────────────────────────────

  /** Increment a numeric field. Returns new value. */
  public async increment(field: string, amount = 1): Promise<number> {
    this.applyPendingScopes();
    const { sql: filterSql, params: filterParams } = this.buildFilter();
    // The filter's placeholders are numbered $1..$N, so the amount must bind
    // AFTER them as $N+1 — otherwise it collides with the first filter param
    // (e.g. `... + $1 WHERE id = $1`) and the wrong value lands in each slot.
    const amountPlaceholder = `$${filterParams.length + 1}`;
    const updateSql =
      `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} ` +
      `SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + ${amountPlaceholder} ` +
      (filterSql ? `WHERE ${filterSql.replace("WHERE ", "")} ` : "") +
      `RETURNING ${this.driver.dialect.quoteIdentifier(field)}`;
    const result = await this.driver.query<Record<string, number>>(updateSql, [
      ...filterParams,
      amount,
    ]);
    return result.rows[0]?.[field] ?? 0;
  }

  /** Decrement a numeric field. Returns new value. */
  public async decrement(field: string, amount = 1): Promise<number> {
    return this.increment(field, -amount);
  }

  /** Increment a field for all matching rows. Returns affected row count. */
  public async incrementMany(field: string, amount = 1): Promise<number> {
    this.applyPendingScopes();
    const { sql: filterSql, params: filterParams } = this.buildFilter();
    // Amount binds last ($N+1) so it never collides with the filter's $1..$N.
    const amountPlaceholder = `$${filterParams.length + 1}`;
    const updateSql =
      `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} ` +
      `SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + ${amountPlaceholder}` +
      (filterSql ? ` WHERE ${filterSql.replace("WHERE ", "")}` : "");
    const result = await this.driver.query(updateSql, [...filterParams, amount]);
    return result.rowCount ?? 0;
  }

  /** Decrement a field for all matching rows. Returns affected row count. */
  public async decrementMany(field: string, amount = 1): Promise<number> {
    return this.incrementMany(field, -amount);
  }

  // ─── Chunking / Pagination ───────────────────────────────────

  /**
   * Process results in memory-efficient chunks.
   *
   * @example
   * await User.query().chunk(100, async (rows, idx) => { ... })
   */
  public async chunk(size: number, callback: ChunkCallback<T>): Promise<void> {
    let chunkIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const chunk = await this.clone()
        .skip(chunkIndex * size)
        .limit(size)
        .get();
      if (chunk.length === 0) break;

      const shouldContinue = await callback(chunk, chunkIndex);
      if (shouldContinue === false) break;

      hasMore = chunk.length === size;
      chunkIndex++;
    }
  }

  /** Page-based pagination. */
  public async paginate(options?: PaginationOptions): Promise<PaginationResult<T>> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.clone().skip(skip).limit(limit).get(),
      this.count(),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
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
  public cursor(after?: unknown, before?: unknown): this {
    this.addOperation("cursor", { after, before });
    return this;
  }

  /** Cursor-based pagination. */
  public async cursorPaginate(
    options?: CursorPaginationOptions,
  ): Promise<CursorPaginationResult<T>> {
    // Fall back to fluently-recorded cursor op if options.cursor not provided
    const cursorOp = this.getOps("cursor")[0];
    const recordedCursor = cursorOp?.data.after;

    const {
      limit = 10,
      cursor = recordedCursor,
      column = "id",
      direction = "next",
    } = options ?? {};

    if (cursor) {
      this.where(column, direction === "next" ? ">" : "<", cursor);
    }

    this.orderBy(column, direction === "next" ? "asc" : "desc");
    const results = await this.limit(limit + 1).get();
    const hasMore = results.length > limit;
    let data = hasMore ? results.slice(0, limit) : results;
    if (direction === "prev") data = data.reverse();

    let nextCursor: unknown;
    let prevCursor: unknown;
    let hasPrev = false;

    if (data.length > 0) {
      const firstItem = (data[0] as Record<string, unknown>)[column];
      const lastItem = (data[data.length - 1] as Record<string, unknown>)[column];

      if (direction === "next") {
        nextCursor = hasMore ? lastItem : undefined;
        if (cursor) {
          hasPrev = true;
          prevCursor = firstItem;
        }
      } else {
        prevCursor = hasMore ? firstItem : undefined;
        hasPrev = hasMore;
        if (cursor) nextCursor = lastItem;
      }
    }

    return { data, pagination: { hasMore, hasPrev, nextCursor, prevCursor } };
  }

  // ─── Mutation methods ────────────────────────────────────────

  /** Delete matching rows. Returns deleted count. */
  public async delete(): Promise<number> {
    this.applyPendingScopes();
    const { sql, params } = this.buildFilter();
    const deleteSql = `DELETE FROM ${this.driver.dialect.quoteIdentifier(this.table)} ${sql}`;
    const result = await this.driver.query(deleteSql, params);
    return result.rowCount ?? 0;
  }

  /** Delete the first matching row. */
  public async deleteOne(): Promise<number> {
    return this.limit(1).delete();
  }

  /** Update matching rows. */
  public async update(fields: Record<string, unknown>): Promise<number> {
    this.applyPendingScopes();
    const result = await this.driver.updateMany(this.table, {}, { $set: fields });
    return result.modifiedCount;
  }

  /** Unset fields from matching rows. */
  public async unset(...fields: string[]): Promise<number> {
    this.applyPendingScopes();
    const updateObj: Record<string, 1> = {};
    for (const field of fields) updateObj[field] = 1;
    const result = await this.driver.updateMany(this.table, {}, { $unset: updateObj });
    return result.modifiedCount;
  }

  // ─── Inspection / Debugging ───────────────────────────────────

  /**
   * Return the SQL + bindings without executing.
   *
   * Runs the same prelude as `get()` (scopes, joinWith expansion, joinRelations,
   * countRelations) so the preview matches what would actually be sent to the
   * database. The apply* methods are idempotent — calling `parse()` then `get()`
   * does not double-emit operations.
   */
  public parse(): DriverQuery {
    this.applyPendingScopes();
    this._processJoinWithOps();
    this.applyJoinRelations();
    this.applyHasRelations();
    this.applyCountRelations();
    this.applyGroupByAggregates();

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: toParserOps(this.operations),
    });
    return parser.parse();
  }

  /** Formatted SQL string (for logging/debugging). */
  public pretty(): string {
    const { query = "", bindings } = this.parse();
    return `${query}\n-- Bindings: ${JSON.stringify(bindings ?? [])}`;
  }

  /** Run EXPLAIN ANALYZE on the query. */
  public async explain(): Promise<unknown> {
    const { query = "", bindings = [] } = this.parse();
    const result = await this.driver.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
      bindings,
    );
    return result.rows;
  }

  // ─── Utility ──────────────────────────────────────────────────

  /** Extend the builder with a driver-specific extension. */
  public extend<R>(extension: string, ..._args: unknown[]): R {
    throw new Error(`Extension "${extension}" is not supported by PostgresQueryBuilder`);
  }

  /** Pluck scalar values for a single field (alias for pluck). */
  public async pluckOne<TResult = unknown>(field: string): Promise<TResult[]> {
    const results = await this.select([field]).get<Record<string, TResult>>();
    return results.map((row) => row[field]);
  }

  // ============================================================================
  // JOIN RELATIONS — INTERNAL PIPELINE
  // ============================================================================

  /**
   * Before `get()` runs the parser, consume any joinWith ops recorded by the base
   * class and expand them into the joinRelations Map.
   */
  private _processJoinWithOps(): void {
    const joinWithOps = this.operations.filter((op) => op.type === "joinWith");
    if (joinWithOps.length === 0) return;

    // Remove joinWith ops from main operations — they are consumed here
    this.operations = this.operations.filter((op) => op.type !== "joinWith");

    for (const op of joinWithOps) {
      const constraints = op.data.constraints as Record<
        string,
        string | ((q: QueryBuilder) => void)
      >;
      for (const [path, constraint] of Object.entries(constraints)) {
        // Re-delegate to the extended joinWith implementation
        if (!constraint || constraint === "") {
          this.joinWith(path);
        } else {
          this.joinWith({ [path]: constraint });
        }
      }
    }
  }

  /**
   * Translate each entry in `joinRelations` into actual JOIN + selectRelatedColumns operations.
   *
   * Idempotent — guarded by `joinRelationsApplied` so repeat calls (e.g.
   * `parse()` followed by `get()`) don't double-emit operations.
   */
  private applyJoinRelations(): void {
    if (this.joinRelationsApplied || this.joinRelations.size === 0) {
      return;
    }

    this.joinRelationsApplied = true;

    for (const [path, config] of this.joinRelations) {
      const RelatedModel = tryResolveModelClass(config.model) as
        | { table: string; name?: string; primaryKey?: string }
        | undefined;

      if (!RelatedModel) {
        throw new Error(`Relation model not found for ${path}`);
      }

      const relatedTable = (RelatedModel as { table: string }).table;
      const alias = config.alias;
      const parentTable = config.parentPath
        ? this.joinRelations.get(config.parentPath)!.alias
        : this.table;

      const parentModel = config.parentModel as { name?: string; primaryKey?: string } | undefined;
      const relatedModelMeta = RelatedModel as { name?: string; primaryKey?: string };

      let localField: string;
      let foreignField: string;

      const conventions = this.dataSource?.relationDefaults;

      if (config.type === "belongsTo") {
        localField =
          config.foreignKey ?? inferBelongsToForeignKey(config.relationName ?? "", conventions);
        foreignField = config.ownerKey ?? relatedModelMeta.primaryKey ?? "id";
      } else {
        localField = config.localKey ?? parentModel?.primaryKey ?? "id";
        foreignField =
          config.foreignKey ?? inferHasForeignKey(parentModel?.name ?? "Model", conventions);
      }

      // hasMany uses a correlated subquery in SELECT (no JOIN) to avoid row explosion
      if (config.type !== "hasMany") {
        this.addOperation("leftJoin", {
          table: relatedTable,
          alias,
          localField: `${parentTable}.${localField}`,
          foreignField,
          // For hasOne/belongsTo joinWith with a constraint callback, the parser
          // appends the constraint's where-clauses to the JOIN's ON condition
          // (not the outer WHERE, which would convert LEFT JOIN semantics into
          // INNER JOIN — main rows without a matching constraint-passing related
          // row would disappear).
          constraintOps: config.constraintOps,
        });
      }

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
        constraintOps: config.constraintOps, // passed through to parser
      });
    }
  }

  // ============================================================================
  // HAS RELATIONS — INTERNAL PIPELINE
  // ============================================================================

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
  private applyHasRelations(): void {
    if (this.hasRelationsApplied) {
      return;
    }

    const HAS_OP_TYPES = new Set([
      "has",
      "whereHas",
      "orWhereHas",
      "doesntHave",
      "whereDoesntHave",
    ]);

    const hasAnyHasOp = this.operations.some((op) => HAS_OP_TYPES.has(op.type));

    if (!hasAnyHasOp) {
      this.hasRelationsApplied = true;
      return;
    }

    this.hasRelationsApplied = true;

    this.operations = this.operations.map((op) => {
      if (!HAS_OP_TYPES.has(op.type)) {
        return op;
      }

      return this.translateHasOp(op);
    });

    this.rebuildIndex();
  }

  /**
   * Translate one has-family operation into its `whereRaw`/`orWhereRaw`
   * equivalent. Resolves the relation definition, builds the EXISTS or
   * COUNT-comparison subquery, and returns the replacement op.
   */
  private translateHasOp(op: Op): Op {
    const data = op.data as {
      relation: string;
      subquery?: Op[];
      operator?: string;
      count?: number;
    };

    const definition = this.relationDefinitions?.[data.relation] as
      | Record<string, unknown>
      | undefined;

    if (!definition) {
      const modelName = (this.modelClass as { name?: string } | undefined)?.name ?? "unknown";
      throw new Error(`${op.type}: Relation "${data.relation}" not found on model ${modelName}`);
    }

    const RelatedModel = tryResolveModelClass(definition.model as ModelRef | undefined) as
      | { table?: string; name?: string; primaryKey?: string }
      | undefined;

    if (!RelatedModel || !(RelatedModel as { table?: string }).table) {
      throw new Error(`${op.type}: Related model not resolvable for "${data.relation}"`);
    }

    const subquery = this.buildHasSubquery(
      op.type,
      data.relation,
      definition,
      RelatedModel as { table: string; name: string; primaryKey?: string },
      data.subquery,
      data.operator,
      data.count,
    );

    const targetType = op.type === "orWhereHas" ? "orWhereRaw" : "whereRaw";

    return {
      type: targetType,
      data: {
        expression: subquery.expression,
        bindings: subquery.bindings,
      },
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
  private buildHasSubquery(
    opType: string,
    relationName: string,
    definition: Record<string, unknown>,
    RelatedModel: { table: string; name: string; primaryKey?: string },
    constraintOps: Op[] | undefined,
    operator: string | undefined,
    count: number | undefined,
  ): { expression: string; bindings: unknown[] } {
    const dialect = this.driver.dialect;
    const quotedSelfTable = dialect.quoteIdentifier(this.table);
    const quotedRelatedTable = dialect.quoteIdentifier(RelatedModel.table);
    const relationType = definition.type as string;
    const selfModel = this.modelClass as { name?: string; primaryKey?: string } | undefined;
    const conventions = this.dataSource?.relationDefaults;

    const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);

    let fromClause: string;
    let joinCondition: string;

    if (relationType === "hasMany" || relationType === "hasOne") {
      const localKey = (definition.localKey as string | undefined) ?? selfModel?.primaryKey ?? "id";
      const foreignKey =
        (definition.foreignKey as string | undefined) ??
        inferHasForeignKey(selfModel?.name ?? "Model", conventions);

      fromClause = quotedRelatedTable;
      joinCondition =
        `${quotedRelatedTable}.${dialect.quoteIdentifier(foreignKey)} = ` +
        `${quotedSelfTable}.${dialect.quoteIdentifier(localKey)}`;
    } else if (relationType === "belongsTo") {
      const ownerKey =
        (definition.localKey as string | undefined) ?? RelatedModel.primaryKey ?? "id";
      const foreignKey =
        (definition.foreignKey as string | undefined) ??
        inferBelongsToForeignKey(relationName, conventions);

      fromClause = quotedRelatedTable;
      joinCondition =
        `${quotedRelatedTable}.${dialect.quoteIdentifier(ownerKey)} = ` +
        `${quotedSelfTable}.${dialect.quoteIdentifier(foreignKey)}`;
    } else if (relationType === "belongsToMany") {
      const pivotTableName =
        (definition.pivot as string | undefined) ??
        inferPivotTable(selfModel?.name ?? "Model", RelatedModel.name, conventions);

      const quotedPivot = dialect.quoteIdentifier(pivotTableName);
      const pivotLocalCol =
        (definition.localKey as string | undefined) ??
        inferPivotKey(selfModel?.name ?? "Model", conventions);
      const pivotForeignCol =
        (definition.foreignKey as string | undefined) ??
        inferPivotKey(RelatedModel.name, conventions);
      const selfPk =
        (definition.pivotLocalKey as string | undefined) ?? selfModel?.primaryKey ?? "id";
      const relatedPk =
        (definition.pivotForeignKey as string | undefined) ?? RelatedModel.primaryKey ?? "id";

      // Constraint-free: pivot-only count. With constraint: INNER JOIN related so
      // the constraint can target related columns.
      if (!constraintOps || constraintOps.length === 0) {
        fromClause = quotedPivot;
        joinCondition =
          `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ` +
          `${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;
      } else {
        fromClause =
          `${quotedPivot} INNER JOIN ${quotedRelatedTable} ON ` +
          `${quotedRelatedTable}.${dialect.quoteIdentifier(relatedPk)} = ` +
          `${quotedPivot}.${dialect.quoteIdentifier(pivotForeignCol)}`;
        joinCondition =
          `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ` +
          `${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;
      }
    } else {
      throw new Error(
        `${opType}: Unsupported relation type "${relationType}" for "${relationName}"`,
      );
    }

    const fullWhere = where.fragment ? `${joinCondition} AND ${where.fragment}` : joinCondition;

    // `has` with custom operator/count compiles to a COUNT comparison; everything
    // else uses EXISTS / NOT EXISTS for short-circuit behaviour.
    const isCountComparison =
      opType === "has" && ((operator !== undefined && operator !== ">=") || (count ?? 1) !== 1);

    if (isCountComparison) {
      const op = operator ?? ">=";
      const compareCount = count ?? 1;

      return {
        expression: `(SELECT COUNT(*) FROM ${fromClause} WHERE ${fullWhere}) ${op} ${compareCount}`,
        bindings: where.bindings,
      };
    }

    const negate = opType === "doesntHave" || opType === "whereDoesntHave";
    const keyword = negate ? "NOT EXISTS" : "EXISTS";

    return {
      expression: `${keyword} (SELECT 1 FROM ${fromClause} WHERE ${fullWhere})`,
      bindings: where.bindings,
    };
  }

  // ============================================================================
  // COUNT RELATIONS — INTERNAL PIPELINE
  // ============================================================================

  /**
   * Translate each entry in `countRelations` into a correlated COUNT subquery
   * emitted as a `selectRaw` operation. Runs after `applyJoinRelations` so the
   * "preserve main table columns" guard sees any joins already in place.
   *
   * Idempotent — guarded by `countRelationsApplied` so repeat calls (e.g.
   * `parse()` followed by `get()`) don't double-emit operations.
   */
  private applyCountRelations(): void {
    if (this.countRelationsApplied || this.countRelations.size === 0) {
      return;
    }

    this.countRelationsApplied = true;

    this.ensureMainColumnsForCount();

    for (const [alias, entry] of this.countRelations) {
      const definition = this.relationDefinitions?.[entry.relation] as
        | Record<string, unknown>
        | undefined;

      if (!definition) {
        const modelName = (this.modelClass as { name?: string } | undefined)?.name ?? "unknown";
        throw new Error(`withCount: Relation "${entry.relation}" not found on model ${modelName}`);
      }

      const RelatedModel = tryResolveModelClass(definition.model as ModelRef | undefined) as
        | { table?: string; name?: string }
        | undefined;

      if (!RelatedModel || !(RelatedModel as { table?: string }).table) {
        throw new Error(
          `withCount: Related model not resolvable for "${entry.relation}" (alias "${alias}")`,
        );
      }

      const subquery = this.buildCountSubquery(
        alias,
        entry.relation,
        definition,
        RelatedModel as { table: string; name: string },
        entry.constraintOps,
      );

      this.addOperation("selectRaw", {
        expression: subquery.expression,
        bindings: subquery.bindings,
      });
    }
  }

  /**
   * Without an explicit `select(...)` or any `selectRaw`/`selectRelatedColumns`
   * already pushed, the parser's "no selects → SELECT *" fallback would be
   * suppressed once we add count expressions. Push `<table>.*` first so the
   * caller's columns survive.
   */
  private ensureMainColumnsForCount(): void {
    const hasExistingSelect = this.operations.some(
      (op) => op.type === "select" || op.type === "selectRaw" || op.type === "selectRelatedColumns",
    );

    if (hasExistingSelect) {
      return;
    }

    const quotedTable = this.driver.dialect.quoteIdentifier(this.table);

    this.addOperation("selectRaw", {
      expression: `${quotedTable}.*`,
      bindings: [],
    });
  }

  /**
   * Build a single correlated-subquery expression for a count entry. Branches
   * on relation type (hasMany/hasOne/belongsTo/belongsToMany). The optional
   * constraint callback's where-ops are translated via a sub-parser and
   * spliced into the subquery's WHERE clause.
   */
  private buildCountSubquery(
    alias: string,
    relationName: string,
    definition: Record<string, unknown>,
    RelatedModel: { table: string; name: string },
    constraintOps: Op[] | undefined,
  ): { expression: string; bindings: unknown[] } {
    const dialect = this.driver.dialect;
    const quotedAlias = dialect.quoteIdentifier(alias);
    const quotedSelfTable = dialect.quoteIdentifier(this.table);
    const quotedRelatedTable = dialect.quoteIdentifier(RelatedModel.table);
    const relationType = definition.type as string;

    const selfModel = this.modelClass as { name?: string; primaryKey?: string } | undefined;
    const relatedMeta = RelatedModel as { name: string; primaryKey?: string; table: string };
    const conventions = this.dataSource?.relationDefaults;

    if (relationType === "hasMany" || relationType === "hasOne") {
      const localKey = (definition.localKey as string | undefined) ?? selfModel?.primaryKey ?? "id";
      const foreignKey =
        (definition.foreignKey as string | undefined) ??
        inferHasForeignKey(selfModel?.name ?? "Model", conventions);
      const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);

      const fkCondition =
        `${quotedRelatedTable}.${dialect.quoteIdentifier(foreignKey)} = ` +
        `${quotedSelfTable}.${dialect.quoteIdentifier(localKey)}`;
      const fullWhere = where.fragment ? `${fkCondition} AND ${where.fragment}` : fkCondition;

      return {
        expression: `(SELECT COUNT(*) FROM ${quotedRelatedTable} WHERE ${fullWhere})::int AS ${quotedAlias}`,
        bindings: where.bindings,
      };
    }

    if (relationType === "belongsTo") {
      const ownerKey =
        (definition.localKey as string | undefined) ?? relatedMeta.primaryKey ?? "id";
      const foreignKey =
        (definition.foreignKey as string | undefined) ??
        inferBelongsToForeignKey(relationName, conventions);
      const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);

      const condition =
        `${quotedRelatedTable}.${dialect.quoteIdentifier(ownerKey)} = ` +
        `${quotedSelfTable}.${dialect.quoteIdentifier(foreignKey)}`;
      const fullWhere = where.fragment ? `${condition} AND ${where.fragment}` : condition;

      return {
        expression: `(SELECT COUNT(*) FROM ${quotedRelatedTable} WHERE ${fullWhere})::int AS ${quotedAlias}`,
        bindings: where.bindings,
      };
    }

    if (relationType === "belongsToMany") {
      const pivotTableName =
        (definition.pivot as string | undefined) ??
        inferPivotTable(selfModel?.name ?? "Model", relatedMeta.name, conventions);

      const quotedPivot = dialect.quoteIdentifier(pivotTableName);
      const pivotLocalCol =
        (definition.localKey as string | undefined) ??
        inferPivotKey(selfModel?.name ?? "Model", conventions);
      const pivotForeignCol =
        (definition.foreignKey as string | undefined) ??
        inferPivotKey(relatedMeta.name, conventions);
      const selfPk =
        (definition.pivotLocalKey as string | undefined) ?? selfModel?.primaryKey ?? "id";
      const relatedPk =
        (definition.pivotForeignKey as string | undefined) ?? relatedMeta.primaryKey ?? "id";

      const pivotCondition =
        `${quotedPivot}.${dialect.quoteIdentifier(pivotLocalCol)} = ` +
        `${quotedSelfTable}.${dialect.quoteIdentifier(selfPk)}`;

      if (!constraintOps || constraintOps.length === 0) {
        return {
          expression: `(SELECT COUNT(*) FROM ${quotedPivot} WHERE ${pivotCondition})::int AS ${quotedAlias}`,
          bindings: [],
        };
      }

      const where = this.extractCountWhereFragment(RelatedModel.table, constraintOps);
      const join =
        `INNER JOIN ${quotedRelatedTable} ON ${quotedRelatedTable}.${dialect.quoteIdentifier(relatedPk)} = ` +
        `${quotedPivot}.${dialect.quoteIdentifier(pivotForeignCol)}`;
      const fullWhere = where.fragment ? `${pivotCondition} AND ${where.fragment}` : pivotCondition;

      return {
        expression: `(SELECT COUNT(*) FROM ${quotedPivot} ${join} WHERE ${fullWhere})::int AS ${quotedAlias}`,
        bindings: where.bindings,
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
  private extractCountWhereFragment(
    relatedTable: string,
    constraintOps: Op[] | undefined,
  ): { fragment: string; bindings: unknown[] } {
    if (!constraintOps || constraintOps.length === 0) {
      return { fragment: "", bindings: [] };
    }

    const whereOps = constraintOps.filter(
      (op) => op.type.startsWith("where") || op.type.startsWith("orWhere"),
    );

    if (whereOps.length === 0) {
      return { fragment: "", bindings: [] };
    }

    const subParser = new PostgresQueryParser({
      table: relatedTable,
      operations: toParserOps(whereOps),
    });

    const { query = "", bindings = [] } = subParser.parse();
    const match = query.match(/WHERE\s+(.+)$/);

    if (!match) {
      return { fragment: "", bindings: [] };
    }

    const fragment = match[1].replace(/\$\d+/g, "?");

    return { fragment, bindings: bindings ?? [] };
  }

  // ============================================================================
  // GROUP-BY AGGREGATES — INTERNAL PIPELINE
  // ============================================================================

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
  private applyGroupByAggregates(): void {
    if (this.groupByAggregatesApplied) {
      return;
    }

    this.groupByAggregatesApplied = true;

    if (this.aggregateAliases.size === 0) {
      return;
    }

    this.operations = this.operations.map((operation) => {
      if (operation.type !== "having") {
        return operation;
      }

      const field = operation.data.field as string;
      const sql = this.aggregateAliases.get(field);

      if (!sql) {
        return operation;
      }

      const operator = (operation.data.operator as string) ?? "=";

      return {
        type: "havingRaw",
        data: {
          expression: `${sql} ${operator} ?`,
          bindings: [operation.data.value],
        },
      };
    });

    this.rebuildIndex();
  }

  // ============================================================================
  // EAGER LOADING — INTERNAL PIPELINE
  // ============================================================================

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
  private async applyEagerLoading(records: unknown[]): Promise<void> {
    if (!this.modelClass || this.eagerLoadRelations.size === 0 || records.length === 0) {
      return;
    }

    const constraints: Record<string, (query: QueryBuilderContract) => void> = {};

    for (const [name, constraint] of this.eagerLoadRelations) {
      if (typeof constraint === "function") {
        constraints[name] = constraint as (query: QueryBuilderContract) => void;
      }
    }

    const loader = new RelationLoader(records as never, this.modelClass as never);
    await loader.load([...this.eagerLoadRelations.keys()], constraints);
  }

  /**
   * Extract per-relation data from raw DB rows (before hydration).
   * Returns a Map of row index → nested relation data tree.
   */
  private extractJoinedRelationData(records: unknown[]): Map<number, Record<string, unknown>> {
    const result = new Map<number, Record<string, unknown>>();
    if (this.joinRelations.size === 0) return result;

    (records as Record<string, unknown>[]).forEach((record, index) => {
      const relationData: Record<string, unknown> = {};

      // Process shallower paths first so parents exist before children
      const sortedPaths = Array.from(this.joinRelations.keys()).sort(
        (a, b) => a.split(".").length - b.split(".").length,
      );

      for (const path of sortedPaths) {
        const config = this.joinRelations.get(path)!;
        const columnName = config.alias;

        const relatedData = record[columnName];
        delete record[columnName];

        const parsedData =
          relatedData !== null &&
          !(
            typeof relatedData === "object" &&
            Object.values(relatedData as object).every((v) => v === null)
          )
            ? relatedData
            : null;

        const parts = path.split(".");
        const lastPart = parts.pop()!;
        let current = relationData;

        for (const part of parts) {
          if (!current[part]) current[part] = {};
          current = current[part] as Record<string, unknown>;
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
  private attachJoinedRelations(
    records: unknown[],
    joinedData: Map<number, Record<string, unknown>>,
  ): void {
    if (this.joinRelations.size === 0) return;

    const attachNested = (model: unknown, dataTree: unknown, currentPath = ""): void => {
      if (!dataTree || typeof dataTree !== "object") return;

      for (const [key, data] of Object.entries(dataTree as Record<string, unknown>)) {
        const path = currentPath ? `${currentPath}.${key}` : key;
        const config = this.joinRelations.get(path);
        if (!config) continue;

        if (data === null) {
          attachLoadedRelation(model as object, key, null);
          continue;
        }

        const RelatedModel = resolveModelClass(config.model as string);
        if (!RelatedModel) continue;

        const childKeys = Array.from(this.joinRelations.keys())
          .filter((p) => p.startsWith(`${path}.`))
          .map((p) => p.split(".")[path.split(".").length]);

        if (config.type === "hasMany") {
          const rows = Array.isArray(data) ? data : [];
          const instances = rows.map((row: unknown) => {
            const rowData = { ...(row as object) } as Record<string, unknown>;
            for (const childKey of childKeys) delete rowData[childKey];
            return (RelatedModel as { hydrate: (d: unknown) => unknown }).hydrate(rowData);
          });

          attachLoadedRelation(model as object, key, instances as never);
        } else {
          const modelData = { ...(data as object) } as Record<string, unknown>;
          for (const childKey of childKeys) delete modelData[childKey];

          const relatedInstance = (RelatedModel as { hydrate: (d: unknown) => unknown }).hydrate(
            modelData,
          );
          attachNested(relatedInstance, data, path);

          attachLoadedRelation(model as object, key, relatedInstance as never);
        }
      }
    };

    records.forEach((model, index) => {
      const relationData = joinedData.get(index);
      if (relationData) attachNested(model, relationData);
    });
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Build a WHERE-only SQL fragment from `where*` operations on the current builder.
   * Used by DELETE / UPDATE / increment paths.
   */
  private buildFilter(): { sql: string; params: unknown[] } {
    const whereOps = this.operations.filter(
      (op) => op.type.includes("where") || op.type.includes("Where"),
    );

    if (whereOps.length === 0) return { sql: "", params: [] };

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: toParserOps(whereOps),
    });

    const { query = "", bindings = [] } = parser.parse();
    const whereMatch = query.match(/WHERE .+$/);
    return { sql: whereMatch ? whereMatch[0] : "", params: bindings };
  }
}
