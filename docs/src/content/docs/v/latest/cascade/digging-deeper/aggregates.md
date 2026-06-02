---
title: "Aggregates"
sidebar:
  order: 1
  label: "Aggregates"
---

Cascade's query builder isn't only for finding records — it crunches numbers too. Sum a column, group by category, filter by the aggregate result, sort the report. The same vocabulary works on MongoDB and Postgres; you don't write driver-specific syntax for the common cases.

This page covers the whole single-chain aggregation family: simple aggregates (`count`/`sum`/`avg`/`min`/`max`/`countDistinct`), grouping (`groupBy`), filtering grouped results (`having`), and the driver-agnostic `$agg` helpers. Multi-stage analytics (window functions, cross-table rollups) is the [Expressions guide](./expressions.md) and the [Reporting recipe](../recipes/reporting.md).

## Simple aggregates — no grouping

Each of these runs one query and returns a single `Promise<number>`:

```ts
const total     = await Order.query().count();
const revenue   = await Order.query().sum("amount");
const avgAmount = await Order.query().avg("amount");
const cheapest  = await Order.query().min("amount");
const priciest  = await Order.query().max("amount");
```

They compose with `.where(...)` upstream — the filter applies before the aggregate:

```ts
const completedRevenue = await Order.where("status", "completed").sum("amount");
```

### `countDistinct` and `distinct`

```ts
const uniqueCustomers = await Order.query().countDistinct("customerId"); // number
const categories = await Product.query().distinct<string>("category");   // string[]
```

`countDistinct` returns the count of distinct values; `distinct` returns the distinct values themselves as an array. On MongoDB, `countDistinct` ignores nulls by default; on Postgres it's a plain `COUNT(DISTINCT column)`.

## Grouping with `groupBy`

### The basic case

```ts
const grouped = await Order.query().groupBy("category").get();
```

`groupBy(field)` with no aggregates groups records by that field; the result shape is driver-dependent and rarely what you want on its own. Grouping earns its keep when you attach aggregates — next.

### Multiple group fields

Pass an array to group by more than one column:

```ts
await Order.query().groupBy(["category", "status"]).get();
```

### With aggregate operations — the useful form

This is the form you'll reach for most. `groupBy(fields, aggregates)` takes the group field(s) plus an object mapping output names to aggregate expressions:

```ts
import { $agg } from "@warlock.js/cascade";

const stats = await Order.query()
  .groupBy("category", {
    total: $agg.sum("amount"),
    count: $agg.count(),
    avg: $agg.avg("amount"),
  })
  .get();
// each row: { category, total, count, avg }
```

The `$agg.*` helpers produce **driver-agnostic** aggregate expressions — the same code runs on MongoDB and Postgres. Cascade translates each to the native form (`{ $sum: "$amount" }` on Mongo, `SUM(amount)` on Postgres).

The driver-agnostic set is **`$agg.count()`, `$agg.sum(field)`, `$agg.avg(field)`, `$agg.min(field)`, `$agg.max(field)`**. These five behave identically on both drivers.

`$agg.distinct`, `$agg.floor`, `$agg.first`, `$agg.last` are **MongoDB-only**. On Postgres they throw at the `.groupBy()` call — fail-fast, with an actionable message:

```ts
Order.query().groupBy("category", { models: $agg.distinct("sku") });
// On Postgres throws:
// "$agg.distinct is MongoDB-only and not supported on a PostgreSQL groupBy.
//  Use selectRaw / havingRaw with the equivalent SQL (window function /
//  DISTINCT / FLOOR) if you need it here."
```

The reasons are semantic, not laziness: Mongo's `$distinct` returns the *array* of distinct values while SQL `DISTINCT` is a set quantifier (not a scalar aggregate); `$floor` is a scalar function, not an aggregate; `$first`/`$last` need an ordering context SQL window functions require and `$agg` doesn't carry. Rather than silently emit a different-meaning query, Postgres throws and points you at the escape hatch.

### Driver-specific aggregates — the raw escape hatch

When you need an aggregate `$agg.*` doesn't cover, pass a raw expression in the aggregates object. On Postgres that's a SQL string:

```ts
await Order.query()
  .groupBy("category", {
    total: "SUM(amount)",
    weighted: "SUM(amount * weight)",
  })
  .get();
```

On MongoDB it's an operator object (`{ total: { $sum: "$amount" } }`). The raw form is driver-specific by definition — it doesn't carry across drivers, so reach for `$agg.*` first and drop to raw only for what it can't express. (Passing a MongoDB operator object to a Postgres query throws a clear "not portable" error rather than emitting broken SQL.)

### `groupByRaw` — non-column grouping

To group by an expression rather than a plain column (`DATE(created_at)`, a JSON path), use `groupByRaw`:

```ts
await Order.query()
  .groupByRaw("DATE(created_at)")
  .get();
```

Driver-specific; use sparingly. The structured `groupBy` form carries across drivers, `groupByRaw` doesn't.

## Filtering grouped results — `having`

`where` filters records *before* grouping. `having` filters groups *after* aggregation. The field you filter on is the alias you gave the aggregate:

```ts
const bigCategories = await Order.query()
  .groupBy("category", { total: $agg.sum("amount") })
  .having("total", ">", 1000)
  .get();
```

`having("total", ">", 1000)` keeps only groups whose summed `amount` exceeds 1000. `"total"` is the alias from the aggregates object.

:::note — Postgres aliases in HAVING just work

SQL doesn't allow a SELECT alias in a raw `HAVING` clause — `HAVING "total" > 1000` would fail with *"column total does not exist."* Cascade rewrites `.having("total", ...)` into the underlying expression (`HAVING SUM("amount") > $1`) automatically, so you write the alias and it works on both drivers. You don't need to know this — it's called out only so the SQL in your logs doesn't surprise you.

:::

### `having` shapes

Same shape vocabulary as `.where()`:

```ts
.having("total", 1000)            // equality
.having("total", ">", 1000)       // operator
```

A `having` on a grouped *column* (not an aggregate alias) works too and is left as a plain column filter:

```ts
await Order.query()
  .groupBy("category", { total: $agg.sum("amount") })
  .having("category", "=", "books")
  .get();
```

### `havingRaw`

When the having condition is itself a raw expression:

```ts
await Order.query()
  .groupBy("category", { total: $agg.sum("amount") })
  .havingRaw("SUM(amount) > ?", [1000])
  .get();
```

The `?` placeholders bind positionally — same convention as `whereRaw`. Use `havingRaw` only when the structured `having` can't express the condition.

## A complete report

The whole family in one chain — "top 10 categories by completed-order revenue, at least 5000 total, highest first":

```ts
const topCategories = await Order.query()
  .where("status", "completed")          // filter rows BEFORE grouping
  .groupBy("category", {
    total: $agg.sum("amount"),
    count: $agg.count(),
  })
  .having("total", ">", 5000)            // filter groups AFTER aggregation
  .orderBy("total", "desc")
  .limit(10)
  .get();
// each row: { category, total, count }
```

One query, both drivers. The chain reads in execution order: filter rows, group, aggregate, filter groups, sort, limit.

## Pitfalls

### `.where()` vs `.having()` — put the filter in the right place

`.where()` filters *records before grouping* — it's cheaper and can use indexes. `.having()` filters *groups after aggregation* — it can only reference aggregate results. Filter as early as possible:

```ts
// ✅ status filter before grouping (indexed, fewer rows to aggregate)
.where("status", "completed").groupBy("category", { total: $agg.sum("amount") })

// ✅ revenue threshold after grouping (it's an aggregate — nowhere else it can go)
.having("total", ">", 5000)
```

Putting a row-level filter in `having` still works but makes the database aggregate rows it's about to discard. Putting an aggregate condition in `where` is impossible — the aggregate doesn't exist yet at that stage.

### Selecting non-aggregate columns in a group

SQL requires every non-aggregate selected column to appear in `groupBy`. MongoDB is more permissive but leaves non-grouped columns undefined. Cascade's `groupBy(fields, aggregates)` shape sidesteps the whole class of error by being explicit: the first argument is what's grouped, the second is what's aggregated. Don't reach for `.select()` alongside it expecting arbitrary columns through.

### Empty results return `0`, not `null`

Verified on both drivers: `count`, `sum`, `avg`, `min`, `max`, and `countDistinct` all return **`0`** when no rows match — not `null`, not `undefined`.

```ts
const revenue = await Order.where("status", "nonexistent").sum("amount");
// → 0  (not null)
```

The footgun isn't a stray `null` to guard — it's the opposite. `min()` / `max()` / `avg()` returning `0` for an empty set is **indistinguishable from a legitimate `0`**. If `0` is a meaningful value in your data and "no rows" needs different handling, gate on the count first:

```ts
const matched = await Order.where(filter).count();
const lowest = matched > 0 ? await Order.where(filter).min("amount") : null;
```

## Going further

- **Window functions** (running totals, ranks, partition aggregates), `selectCase`/`selectWindow`: [Expressions guide](./expressions.md)
- **Cross-table aggregates** via joins: [Joins guide](./joins.md)
- **Time-bucket reports** (revenue per day/month) and the full reporting pattern: [Reporting recipe](../recipes/reporting.md)
- **Every aggregate method signature**: [Query Builder API reference](../reference/query-builder-api.md)
