---
title: "Expressions — raw, computed, and aggregate"
sidebar:
  order: 5
  label: "Expressions"
---

The query builder covers most of what you'll ever need: `.where()`, `.select()`, `.join()`, `.groupBy()`, the lot. But every ORM eventually meets a query that doesn't fit the structured API — a window function, a `CASE` expression, a `$facet` aggregation, a `COALESCE` over three fields. This page covers the **expression family**: the structured helpers (`selectCase`, `selectWindow`, `selectConcat`, ...), the abstract aggregate helpers (`$agg.*`), and the raw escape hatches when nothing else fits.

Three categories:

1. **Driver-agnostic aggregate expressions** (`$agg.count()`, `$agg.sum("amount")`, ...) — Cascade translates to the right native shape per driver.
2. **Structured projection helpers** (`selectCase`, `selectWhen`, `selectConcat`, `selectCoalesce`, `selectWindow`, ...) — typed shortcuts for common expression patterns.
3. **Raw escape hatches** (`selectRaw`, `whereRaw`, `orderByRaw`, `groupByRaw`, `havingRaw`, `joinRaw`) — drop into the driver's native syntax when nothing else expresses what you need.

## Driver-agnostic aggregates — `$agg.*`

The `$agg` helpers produce **abstract aggregate expressions** that work the same on MongoDB and Postgres. You use them inside `groupBy(fields, aggregates)`:

```ts
import { $agg } from "@warlock.js/cascade";

const stats = await Order.query()
  .groupBy("category", {
    total: $agg.sum("amount"),
    count: $agg.count(),
    avgAmount: $agg.avg("amount"),
    minAmount: $agg.min("amount"),
    maxAmount: $agg.max("amount"),
    distinctSkus: $agg.distinct("sku"),
  })
  .get();
// each row: { category, total, count, avgAmount, minAmount, maxAmount, distinctSkus }
```

The complete vocabulary:

| Helper | What it does | MongoDB | SQL |
| ------ | ------------ | ------- | --- |
| `$agg.count()` | count of rows in the group | `{ $sum: 1 }` | `COUNT(*)` |
| `$agg.sum(field)` | sum of a numeric field | `{ $sum: "$field" }` | `SUM(field)` |
| `$agg.avg(field)` | average of a numeric field | `{ $avg: "$field" }` | `AVG(field)` |
| `$agg.min(field)` | minimum value | `{ $min: "$field" }` | `MIN(field)` |
| `$agg.max(field)` | maximum value | `{ $max: "$field" }` | `MAX(field)` |
| `$agg.distinct(field)` | distinct values | `{ $distinct: "$field" }` | **MongoDB-only** — throws on Postgres |
| `$agg.floor(field)` | floor of a numeric field | `{ $floor: "$field" }` | **MongoDB-only** — throws on Postgres |
| `$agg.first(field)` | first value in group order | `{ $first: "$field" }` | **MongoDB-only** — throws on Postgres |
| `$agg.last(field)` | last value in group order | `{ $last: "$field" }` | **MongoDB-only** — throws on Postgres |

**The first five are cross-driver. The last four (`distinct`/`floor`/`first`/`last`) are MongoDB-only.** On Postgres they throw at the `.groupBy()` call with an actionable message — Mongo's `$distinct` returns an array (SQL `DISTINCT` is a set quantifier, not a scalar aggregate), `$floor` is a scalar function not an aggregate, and `$first`/`$last` need a window-function ordering context `$agg` doesn't carry. Rather than emit a silently-different query, Postgres fails fast and points at `selectRaw` / `havingRaw` with the equivalent SQL. See the [Aggregates guide](./aggregates.md#with-aggregate-operations--the-useful-form).

## Driver-specific aggregates — raw expressions inside `groupBy`

When `$agg.*` doesn't cover what you need — driver-specific functions, complex math, conditional aggregates — pass a raw expression in the same `groupBy(fields, aggregates)` slot:

```ts
// MongoDB raw expression
query.groupBy("category", {
  total: { $sum: "$amount" },
  weightedScore: { $sum: { $multiply: ["$score", "$weight"] } },
});

// Postgres raw expression (string-style)
query.groupBy("category", {
  total: "SUM(amount)",
  weighted: "SUM(score * weight)",
});
```

The structured `$agg.*` form is the right default — same code works on both drivers. The raw form is the escape hatch for things `$agg.*` can't express.

## `selectCase` — branching projection

Compute a value with branching logic at projection time:

```ts
query.selectCase(
  [
    { when: { $eq: ["$status", "active"] }, then: "Active" },
    { when: { $eq: ["$status", "pending"] }, then: "Awaiting" },
    { when: { $eq: ["$status", "banned"] }, then: "Suspended" },
  ],
  "Unknown",       // otherwise / default
  "statusLabel",   // alias
);
```

Each `when` is a driver-native condition; each `then` is the value that wins if the condition matches. The `otherwise` value applies when no `when` matches. Output appears on each result row under the alias.

## `selectWhen` — single-condition shortcut

For the "if X then Y else Z" case, `selectWhen` is shorter than the full `selectCase`:

```ts
query.selectWhen(
  { $gt: ["$age", 18] }, // condition
  "Adult",               // then
  "Minor",               // else
  "ageLabel",            // alias
);
```

Same shape, half the keystrokes. Reach for `selectCase` when you have three or more branches.

## `selectConcat` — string concatenation

Build a fullname, formatted address, slug — anything that's "glue several fields together":

```ts
query.selectConcat(["$firstName", " ", "$lastName"], "fullName");
// each row: { fullName: "Ada Lovelace" }
```

Items can be field references (`"$firstName"`) or literal strings (`" "`). Cascade emits the right concatenation primitive per driver (`$concat` on Mongo, `||` or `CONCAT(...)` on SQL).

## `selectCoalesce` — first non-null

Return the first non-null value in a list — the classic "use nickname if set, else name, else fall back":

```ts
query.selectCoalesce(["$nickname", "$name", "$username"], "displayName");
```

Translates to `$ifNull` chains on Mongo and `COALESCE(...)` on SQL.

## `selectWindow` — window functions

Window functions compute over a "window" of rows around the current one — running totals, ranks, partition aggregates. Cascade's `selectWindow` is a thin pass-through to the driver's window syntax:

```ts
query.selectWindow({
  partitionBy: "$category",
  sortBy: { createdAt: 1 },
  output: { rank: { $denseRank: {} } },
});
```

The `spec` argument is driver-native — MongoDB uses the `$setWindowFields` shape (shown above); Postgres uses the `OVER (PARTITION BY ... ORDER BY ...)` flavor. Different driver, different shape — the page doesn't pretend otherwise. If your codebase targets both drivers, write the window in `selectRaw` and branch on driver type at the call site, or restrict the use case to one driver and document why.

## `selectSub` — sub-select expressions

When you want a value computed from a subquery in the projection:

```ts
query.selectSub({ $sum: "$items.price" }, "itemsTotal");
```

The shape is driver-native (MongoDB `$expr`-style here; SQL would take a string `"(SELECT SUM(price) FROM items WHERE ...)"`). Cascade injects it under the alias with no rewriting.

`addSelectSub` is the additive variant — same shape, doesn't clear previous selects.

## `selectExists` / `selectCount` — projection helpers

Smaller utilities for common projections:

```ts
query.selectExists("deletedAt", "isDeleted");           // boolean — does the path exist?
query.selectCount("permissions", "permissionsCount");   // number — array length
```

These are sugar over what you could write with `selectRaw`, but they read better at the call site and survive driver swaps.

## `selectAggregate` — single aggregate without `groupBy`

When you want a *single* aggregate as part of a regular projection (not inside `groupBy`), `selectAggregate` is the form:

```ts
query.selectAggregate("items.price", "sum", "itemsTotal");
// → { ...other_fields, itemsTotal: <sum of items.price> }
```

Niche — most apps either want grouped aggregates (use `groupBy(fields, aggregates)`) or whole-query aggregates (use the `.sum()`/`.avg()`/`.count()` terminators). Reach for this when you specifically want one aggregate-shaped projection on a non-grouped query.

## The raw escape hatches

When the structured helpers can't express what you need, every layer of the query builder has a `*Raw` counterpart that takes the driver's native syntax verbatim. Use them sparingly — the more raw expressions you scatter through your code, the harder it is to swap drivers later.

### `selectRaw(expression, bindings?)` / `selectRawMany(definitions)`

```ts
// MongoDB
query.selectRaw({ total: { $sum: "$items.price" } });

// Postgres
query.selectRaw("SUM(items.price) AS total");

// Several at once
query.selectRawMany([
  { alias: "firstName", expression: "$profile.name.first" },
  { alias: "isAdult",   expression: { $gte: ["$age", 18] } },
]);
```

### `whereRaw(expression, bindings?)` / `orWhereRaw(...)`

```ts
// MongoDB — $expr clause
query.whereRaw({ $expr: { $gt: ["$stock", "$reserved"] } });

// Postgres — parameterized SQL
query.whereRaw("age > ? AND created_at >= ?", [30, lastMonth]);
```

The `bindings` array maps to positional parameters (`?` in SQL). Bindings exist for SQL safety; on MongoDB, the expression goes through unchanged.

### `orderByRaw(expression, bindings?)`

```ts
query.orderByRaw("RANDOM()");
query.orderByRaw("LENGTH(?) DESC", ["name"]);
```

### `groupByRaw(expression, bindings?)` / `havingRaw(expression, bindings?)`

```ts
// Group by a computed expression
query.groupByRaw("DATE(created_at)");

// Filter grouped results with a raw expression
query.havingRaw("COUNT(*) > ?", [10]);
```

### `joinRaw(expression, bindings?)`

Covered in detail in the [Joins guide](./joins.md). Use for lateral joins, `$graphLookup`, `$unionWith`, `$facet`, and anything else the structured methods can't express.

### `raw(builder)` and `selectDriverProjection(callback)`

Last-resort escape hatches that mutate the driver's underlying query object directly:

```ts
query.raw(native => {
  // Mutate the native query before execution
  return native;
});

query.selectDriverProjection(projection => {
  projection.score = { $meta: "textScore" }; // MongoDB-specific
});
```

If you find yourself reaching for these, it's worth a moment's reflection — usually a structured helper can express the same thing more durably. Reserve `raw` / `selectDriverProjection` for genuinely driver-specific shapes (text-score meta, native pipeline stages, custom operators) that the structured API can't represent and probably never should.

## A worked example — bringing it together

A reporting query that uses the abstract aggregates, a CASE expression, a raw filter, and a window function:

```ts
const report = await Order.query()
  .where("status", "completed")
  .whereDateBetween("createdAt", [startOfMonth, endOfMonth])
  .groupBy("category", {
    revenue: $agg.sum("amount"),
    orderCount: $agg.count(),
    avgOrder: $agg.avg("amount"),
  })
  .selectWhen(
    { $gt: ["$revenue", 10_000] },
    "high-volume",
    "low-volume",
    "tier",
  )
  .having("revenue", ">", 0)
  .orderBy("revenue", "desc")
  .get();
// each row: { category, revenue, orderCount, avgOrder, tier }
```

Five layers of expression in one query:

1. Structured filters (`where`, `whereDateBetween`).
2. Driver-agnostic aggregates (`$agg.sum`, `$agg.count`, `$agg.avg`).
3. Branching projection (`selectWhen`).
4. Grouped-result filter (`having`).
5. Standard ordering.

The structured pieces survive driver swaps. The day you reach for `selectRaw` or `joinRaw` is the day a portion of the query stops being portable — that's fine as long as you've made the choice deliberately.

## When to reach for what — quick decision

| Situation | Reach for |
| --------- | --------- |
| Standard aggregate inside `groupBy` (works on both drivers) | `$agg.*` helpers |
| Branching projection with 2 branches | `selectWhen` |
| Branching projection with 3+ branches | `selectCase` |
| String concatenation | `selectConcat` |
| First non-null fallback | `selectCoalesce` |
| Single aggregate on a non-grouped query | `selectAggregate` |
| Sub-select inside projection | `selectSub` |
| Window function (rank, partition aggregates, running totals) | `selectWindow` |
| Driver-specific aggregate inside `groupBy` | Raw expression in the aggregates object |
| Anything the structured helpers can't express | `selectRaw` / `whereRaw` / `joinRaw` / etc. |

## Going further

- **Aggregates with grouping** in full: [Aggregates guide](./aggregates.md)
- **Joins** including `joinRaw` for `$graphLookup` / lateral joins: [Joins guide](./joins.md)
- **JSON path expressions** (`selectJson`, `selectJsonRaw`, `deselectJson`): [JSON fields guide](./json-fields.md)
- **Method-level signatures** for every expression helper: [Query Builder API reference](../reference/query-builder-api.md)
