/**
 * Database-agnostic, **typed** column expressions for aggregate inputs.
 *
 * These let `$agg.sum(...)` (and any future expression-accepting aggregate)
 * operate on a composed arithmetic expression — e.g. `price * quantity` — not
 * just a bare column, while staying portable across drivers.
 *
 * The builders are grouped under a single `$expr` object (mirroring `$agg`),
 * so the package root exposes exactly two expression namespaces — `$agg` for
 * aggregates and `$expr` for the scalar arithmetic that feeds them — rather
 * than a handful of collision-prone bare verbs (`mul`, `add`, `col`, …).
 *
 * The expression tree is a small, closed union of safe nodes:
 *
 * - `$expr.col("price")` — a column reference (driver quotes/escapes it)
 * - `$expr.lit(2)` — a numeric/boolean literal
 * - `$expr.mul(a, b, …)` / `$expr.add(…)` / `$expr.sub(a, b)` / `$expr.div(a, b)` — arithmetic
 * - `$expr.raw("price * 1.2")` — an explicit escape hatch for a raw SQL fragment
 *
 * Only `$expr.raw` ever embeds an uninterpreted string, and it is opt-in by
 * name. Everything else is composed from typed nodes, so user-supplied column
 * names flow through the driver's identifier-quoting path rather than being
 * string-interpolated into SQL. This is the boundary the S2 task calls out: a
 * tiny typed DSL for the common safe ops, plus a clearly-named raw escape
 * hatch for everything beyond it.
 *
 * Bare strings are still accepted everywhere a `ColumnExpression` is — a plain
 * string is treated as a column reference (`"price"` === `$expr.col("price")`),
 * so the existing `$agg.sum("amount")` call site keeps working unchanged.
 *
 * @example
 * ```typescript
 * import { $agg, $expr } from "@warlock.js/cascade";
 *
 * query.groupByDate("created_at", "month", {
 *   revenue: $agg.sum($expr.mul("price", "quantity")),
 * });
 * ```
 */

/** Discriminator tag identifying a node in the column-expression tree. */
export type ColumnExpressionType =
  | "column"
  | "literal"
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "raw";

/**
 * A reference to a column/field. The driver is responsible for quoting the
 * name (SQL) or prefixing it with `$` (Mongo) — it is never interpolated raw.
 */
export type ColumnRefExpression = {
  readonly __expr: "column";
  readonly column: string;
};

/** A scalar literal value embedded directly in the expression. */
export type LiteralExpression = {
  readonly __expr: "literal";
  readonly value: number | boolean;
};

/**
 * An arithmetic operation over one or more operands.
 *
 * `add` / `multiply` are variadic; `subtract` / `divide` take exactly two
 * operands (left, right) since they are not associative.
 */
export type ArithmeticExpression = {
  readonly __expr: "add" | "subtract" | "multiply" | "divide";
  readonly operands: ColumnExpression[];
};

/**
 * A raw expression escape hatch. The string is emitted verbatim into the
 * generated SQL — callers MUST NOT build it from untrusted input. This is the
 * documented boundary for anything the typed nodes above don't cover.
 */
export type RawColumnExpression = {
  readonly __expr: "raw";
  readonly expression: string;
};

/**
 * Any node in the typed column-expression tree. A bare `string` is also a
 * valid expression input wherever this type is accepted — it is interpreted as
 * a column reference.
 */
export type ColumnExpression =
  | ColumnRefExpression
  | LiteralExpression
  | ArithmeticExpression
  | RawColumnExpression;

/** Input accepted by expression-aware helpers: a typed node or a column-name string. */
export type ColumnExpressionInput = ColumnExpression | string;

/**
 * Type guard: is `value` one of the typed column-expression nodes?
 *
 * @param value - The value to test
 * @returns `true` when `value` is a `ColumnExpression` node
 */
export function isColumnExpression(value: unknown): value is ColumnExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ColumnExpression).__expr === "string"
  );
}

/**
 * Reference a column/field by name.
 *
 * @param column - The column/field name
 * @returns A column-reference expression node
 */
function col(column: string): ColumnRefExpression {
  return { __expr: "column", column };
}

/**
 * A scalar literal (number or boolean) operand.
 *
 * @param value - The literal value
 * @returns A literal expression node
 */
function lit(value: number | boolean): LiteralExpression {
  return { __expr: "literal", value };
}

/**
 * Multiply two or more operands.
 *
 * @param operands - Column names, literals, or nested expression nodes
 * @returns A multiply expression node
 */
function mul(...operands: ColumnExpressionInput[]): ArithmeticExpression {
  return { __expr: "multiply", operands: operands.map(toColumnExpression) };
}

/**
 * Add two or more operands.
 *
 * @param operands - Column names, literals, or nested expression nodes
 * @returns An add expression node
 */
function add(...operands: ColumnExpressionInput[]): ArithmeticExpression {
  return { __expr: "add", operands: operands.map(toColumnExpression) };
}

/**
 * Subtract `right` from `left`.
 *
 * @param left - The minuend
 * @param right - The subtrahend
 * @returns A subtract expression node
 */
function sub(
  left: ColumnExpressionInput,
  right: ColumnExpressionInput,
): ArithmeticExpression {
  return {
    __expr: "subtract",
    operands: [toColumnExpression(left), toColumnExpression(right)],
  };
}

/**
 * Divide `left` by `right`.
 *
 * @param left - The dividend
 * @param right - The divisor
 * @returns A divide expression node
 */
function div(
  left: ColumnExpressionInput,
  right: ColumnExpressionInput,
): ArithmeticExpression {
  return {
    __expr: "divide",
    operands: [toColumnExpression(left), toColumnExpression(right)],
  };
}

/**
 * Wrap a raw expression string as an escape hatch.
 *
 * The string is emitted verbatim — never build it from untrusted input. Use
 * this only when the typed `$expr.mul` / `$expr.add` / `$expr.sub` /
 * `$expr.div` / `$expr.col` / `$expr.lit` combinators can't express what you
 * need.
 *
 * @param expression - A raw, driver-native expression fragment
 * @returns A raw expression node
 */
function raw(expression: string): RawColumnExpression {
  return { __expr: "raw", expression };
}

/**
 * Normalize an expression input to a `ColumnExpression` node. A bare string
 * becomes a `$expr.col(...)` reference; an existing node passes through
 * unchanged.
 *
 * @param input - A typed expression node or a bare column-name string
 * @returns The corresponding `ColumnExpression` node
 */
export function toColumnExpression(input: ColumnExpressionInput): ColumnExpression {
  return typeof input === "string" ? col(input) : input;
}

/**
 * Typed, database-agnostic column-expression builders.
 *
 * Grouped under one object (like `$agg`) so the scalar arithmetic that feeds
 * an aggregate reads as a single, discoverable namespace: `$agg.sum($expr.mul(
 * "price", "quantity"))`. Each builder returns a plain, closed `ColumnExpression`
 * node — the driver translates it to native SQL / a Mongo pipeline.
 *
 * @example
 * ```typescript
 * import { $agg, $expr } from "@warlock.js/cascade";
 *
 * // SUM(price * quantity)
 * query.groupBy("product_id", { revenue: $agg.sum($expr.mul("price", "quantity")) });
 *
 * // SUM((1 - discount) * price)
 * query.groupBy("product_id", {
 *   net: $agg.sum($expr.mul($expr.sub($expr.lit(1), "discount"), "price")),
 * });
 *
 * // price * 1.2 (e.g. tax)
 * $agg.sum($expr.mul("price", $expr.lit(1.2)));
 *
 * // escape hatch (Postgres-only, emitted verbatim — never from user input)
 * $agg.sum($expr.raw("price * quantity * (1 - discount)"));
 * ```
 */
export const $expr = {
  col,
  lit,
  mul,
  add,
  sub,
  div,
  raw,
};
