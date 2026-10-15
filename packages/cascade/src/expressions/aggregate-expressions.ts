/**
 * Database-agnostic aggregation expressions.
 *
 * `count` / `countDistinct` / `sum` / `avg` / `min` / `max` are **cross-driver**
 * — the same call compiles to the native shape on every supported database
 * (MongoDB `{ $sum: "$field" }`, SQL `SUM(field)`, ...). `countDistinct` uses
 * MongoDB's `$addToSet` + `$size` per-group pattern and SQL `COUNT(DISTINCT …)`.
 *
 * `distinct` / `floor` / `first` / `last` are **MongoDB-only**. They have no
 * single-scalar `GROUP BY` equivalent in SQL, so on Postgres they throw a
 * fail-fast error at the `.groupBy()` call (naming the `selectRaw` /
 * `havingRaw` escape hatch) rather than emit a silently-different query.
 *
 * @example
 * ```typescript
 * import { $agg } from '@warlock.js/cascade';
 *
 * // Works for both MongoDB and SQL
 * Lesson.query()
 *   .groupBy("type", {
 *     count: $agg.count(),
 *     total: $agg.sum("duration"),
 *     avg: $agg.avg("rating")
 *   })
 *   .get();
 * ```
 */

import type { ColumnExpression, ColumnExpressionInput } from "./column-expressions";

/**
 * Abstract aggregate expression format.
 *
 * This format is database-agnostic and will be translated by each driver
 * to their native syntax.
 */
export type AggregateExpression = {
  /** The aggregate function type */
  __agg: AggregateFunction;
  /** The field to aggregate (null for count, or when `__expr` carries a composed expression) */
  __field: string | null;
  /**
   * A typed column expression to aggregate over, when the aggregate operates
   * on more than a bare column (e.g. `price * quantity`). When present, drivers
   * compile this instead of `__field`. Absent for the simple bare-column form
   * so existing `$agg.sum("col")` payloads stay byte-for-byte identical.
   */
  __expr?: ColumnExpression;
};

/**
 * Supported aggregate functions.
 */
export type AggregateFunction =
  | "count"
  | "countDistinct"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "first"
  | "last"
  | "distinct"
  | "floor";

/**
 * Checks if a value is an abstract aggregate expression.
 */
export function isAggregateExpression(value: unknown): value is AggregateExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    "__field" in value &&
    typeof (value as AggregateExpression).__agg === "string"
  );
}

/**
 * Database-agnostic aggregation expression helpers.
 *
 * These helpers create abstract expressions that each driver translates
 * to their native format.
 */
export const $agg = {
  /**
   * Count documents in each group.
   *
   * @returns Abstract count expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   count: $agg.count()
   * });
   * ```
   *
   * Translates to:
   * - MongoDB: `{ $sum: 1 }`
   * - SQL: `COUNT(*)`
   */
  count(): AggregateExpression {
    return { __agg: "count", __field: null };
  },

  /**
   * Count the number of distinct values of a field in each group.
   *
   * @param field - The field name to count distinct values of
   * @returns Abstract count-distinct expression
   *
   * @example
   * ```typescript
   * query.groupBy("country", {
   *   uniqueCities: $agg.countDistinct("city")
   * });
   * ```
   *
   * **Cross-driver.** Translates to:
   * - SQL: `COUNT(DISTINCT city)`
   * - MongoDB: `{ $addToSet: "$city" }` in the `$group` stage, finalized with
   *   `{ $size: "$uniqueCities" }` in the renaming `$project` (the standard
   *   distinct-count-per-group pattern, since `$size` is not a `$group`
   *   accumulator).
   */
  countDistinct(field: string): AggregateExpression {
    return { __agg: "countDistinct", __field: field };
  },

  /**
   * Sum a numeric field — or a composed arithmetic expression — across
   * documents in each group.
   *
   * Pass a bare column name to sum a single field (unchanged from v1), or a
   * typed `$expr` node (`$expr.mul` / `$expr.add` / `$expr.sub` / `$expr.div` /
   * `$expr.col` / `$expr.lit`) to sum a computed value such as `price * quantity`.
   *
   * @param input - A field name or a typed `ColumnExpression`
   * @returns Abstract sum expression
   *
   * @example
   * ```typescript
   * import { $agg, $expr } from "@warlock.js/cascade";
   *
   * // Bare column
   * query.groupBy("type", { totalDuration: $agg.sum("duration") });
   *
   * // Composed expression: SUM(price * quantity)
   * query.groupBy("type", { revenue: $agg.sum($expr.mul("price", "quantity")) });
   * ```
   *
   * Translates to:
   * - SQL: `SUM("duration")` / `SUM(("price" * "quantity"))`
   * - MongoDB: `{ $sum: "$duration" }` / `{ $sum: { $multiply: ["$price", "$quantity"] } }`
   */
  sum(input: ColumnExpressionInput): AggregateExpression {
    if (typeof input === "string") {
      return { __agg: "sum", __field: input };
    }

    return { __agg: "sum", __field: null, __expr: input };
  },

  /**
   * Sum a raw, driver-native expression escape hatch.
   *
   * Equivalent to `$agg.sum($expr.raw(expression))`. The raw string is emitted
   * verbatim into the generated query — never build it from untrusted input.
   * Reach for the typed {@link sum} form first; this exists only for fragments
   * the typed combinators can't express.
   *
   * @param expression - A raw expression fragment (e.g. `"price * quantity"`)
   * @returns Abstract sum expression wrapping the raw fragment
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   net: $agg.sumRaw("price * quantity * (1 - discount)"),
   * });
   * ```
   *
   * Translates to:
   * - SQL: `SUM(price * quantity * (1 - discount))`
   * - MongoDB: throws — raw SQL fragments are not portable to a pipeline; use
   *   the typed {@link sum} form (or `groupByRaw`) on MongoDB instead.
   */
  sumRaw(expression: string): AggregateExpression {
    return {
      __agg: "sum",
      __field: null,
      __expr: { __expr: "raw", expression },
    };
  },

  /**
   * Calculate the average value of a field across documents in each group.
   *
   * @param field - The field name to average
   * @returns Abstract average expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   avgRating: $agg.avg("rating")
   * });
   * ```
   *
   * Translates to:
   * - MongoDB: `{ $avg: "$rating" }`
   * - SQL: `AVG(rating)`
   */
  avg(field: string): AggregateExpression {
    return { __agg: "avg", __field: field };
  },

  /**
   * Get the minimum value of a field across documents in each group.
   *
   * @param field - The field name
   * @returns Abstract min expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   minPrice: $agg.min("price")
   * });
   * ```
   *
   * Translates to:
   * - MongoDB: `{ $min: "$price" }`
   * - SQL: `MIN(price)`
   */
  min(field: string): AggregateExpression {
    return { __agg: "min", __field: field };
  },

  /**
   * Get the maximum value of a field across documents in each group.
   *
   * @param field - The field name
   * @returns Abstract max expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   maxPrice: $agg.max("price")
   * });
   * ```
   *
   * Translates to:
   * - MongoDB: `{ $max: "$price" }`
   * - SQL: `MAX(price)`
   */
  max(field: string): AggregateExpression {
    return { __agg: "max", __field: field };
  },

  /**
   * Get the distinct values of a field across documents in each group.
   *
   * @param field - The field name
   * @returns Abstract distinct expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   distinctColors: $agg.distinct("color")
   * });
   * ```
   *
   * **MongoDB-only.** MongoDB: `{ $distinct: "$color" }` (returns the array
   * of distinct values). On Postgres this throws — SQL `DISTINCT` is a set
   * quantifier, not a scalar aggregate, so there is no equivalent single
   * value to put in a `GROUP BY` projection. Use `selectRaw` if you need a
   * Postgres-specific shape (e.g. `array_agg(DISTINCT color)`).
   */
  distinct(field: string): AggregateExpression {
    return { __agg: "distinct", __field: field };
  },

  /**
   * Get the floor value of a field across documents in each group.
   *
   * @param field - The field name
   * @returns Abstract floor expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   floorPrice: $agg.floor("price")
   * });
   * ```
   *
   * **MongoDB-only.** MongoDB: `{ $floor: "$price" }`. On Postgres this
   * throws — `FLOOR` is a scalar function, not an aggregate, so it is
   * meaningless inside a bare `$group` / `GROUP BY`. Use `selectRaw` with
   * `FLOOR(...)` over the aggregated value if you need it on Postgres.
   */
  floor(field: string): AggregateExpression {
    return { __agg: "floor", __field: field };
  },

  /**
   * Get the first value of a field in each group (order-dependent).
   *
   * @param field - The field name
   * @returns Abstract first expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   firstName: $agg.first("name")
   * });
   * ```
   *
   * **MongoDB-only.** MongoDB: `{ $first: "$name" }` (group-order
   * dependent). On Postgres this throws — the SQL equivalent is
   * `FIRST_VALUE(name) OVER (ORDER BY ...)`, a window function needing an
   * ordering context the `$agg` API doesn't carry. Use `selectRaw` with an
   * explicit window function if you need it on Postgres.
   */
  first(field: string): AggregateExpression {
    return { __agg: "first", __field: field };
  },

  /**
   * Get the last value of a field in each group (order-dependent).
   *
   * @param field - The field name
   * @returns Abstract last expression
   *
   * @example
   * ```typescript
   * query.groupBy("type", {
   *   lastName: $agg.last("name")
   * });
   * ```
   *
   * **MongoDB-only.** MongoDB: `{ $last: "$name" }` (group-order
   * dependent). On Postgres this throws — the SQL equivalent is
   * `LAST_VALUE(name) OVER (ORDER BY ...)`, a window function needing an
   * ordering context the `$agg` API doesn't carry. Use `selectRaw` with an
   * explicit window function if you need it on Postgres.
   */
  last(field: string): AggregateExpression {
    return { __agg: "last", __field: field };
  },
};
