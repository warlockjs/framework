---
name: aggregate-data
description: 'Compute aggregates over a query — scalar `.count()` / `.sum(field)` / `.avg` / `.min` / `.max`, plus grouped rollups via the two-arg `.groupBy(fields, { alias: $agg.* })` with the `$agg` helpers and `.having(alias, op, value)` on computed aggregates. Triggers: `.count`, `.sum`, `.avg`, `.min`, `.max`, `.groupBy`, `.having`, `$agg`, `$agg.sum`, `$agg.count`; "monthly revenue report", "X per category", "group by status", "dashboard rollup"; typical import `import { Model, $agg } from "@warlock.js/cascade"`. Skip: row queries — `@warlock.js/cascade/query-data/SKILL.md`; cached aggregates — `@warlock.js/cache/use-cached-hof/SKILL.md`; competing tools raw SQL `GROUP BY`, `mongoose aggregate`, `prisma` `groupBy`.'
---

# Use aggregates and groupBy

Cascade's query builder isn't only for finding records — it crunches numbers too. The same calls run on MongoDB and Postgres.

## Scalar aggregates

```ts
const total      = await Order.count();                  // count is static on the model
const revenue    = await Order.query().sum("total");
const avgTicket  = await Order.query().avg("total");
const cheapest   = await Order.query().min("total");
const priciest   = await Order.query().max("total");

// Filtered
const monthRevenue = await Order.query()
  .whereDateAfter("created_at", startOfMonth)
  .sum("total");
```

Each returns a single number (`Promise<number>`). Only `count` is a static shortcut on the model; `sum` / `avg` / `min` / `max` (and the date helpers) are query-builder methods — reach them via `Order.query()` or chain off `Order.where(...)`. Date filters take a single date: `whereDate(field, value)` (exact day, time ignored), `whereDateAfter` / `whereDateBefore` (one-sided), `whereDateBetween(field, [a, b])` (range) — there is no 3-arg `whereDate(field, op, value)`. By Cascade convention the scalar terminators return **`0` on zero rows — not `null`** — so you can use the result directly without a null guard.

## Grouped rollups — two-arg `groupBy(fields, aggregates)`

To compute aggregates *per group*, pass a second argument to `groupBy`: an object mapping output aliases to aggregate expressions. Build the expressions with the `$agg` helpers:

```ts
import { $agg } from "@warlock.js/cascade";

const stats = await Order.query()
  .groupBy("category", {
    total: $agg.sum("amount"),
    orders: $agg.count(),
    avg: $agg.avg("amount"),
  })
  .get();
// each row: { category, total, orders, avg }
```

`fields` is a string or string array (`groupBy(["status", "country"], {...})` groups by each combination). Single-arg `groupBy("category")` / `groupBy(["a","b"])` groups **without** computing aggregates.

### `$agg` helpers — five cross-driver, four MongoDB-only

Cross-driver (identical call on MongoDB **and** Postgres):

- `$agg.count()` · `$agg.sum(field)` · `$agg.avg(field)` · `$agg.min(field)` · `$agg.max(field)`

MongoDB-only — on Postgres these **throw at the `.groupBy()` call** with an actionable message (there is no honest single-scalar `GROUP BY` equivalent):

- `$agg.distinct(field)` · `$agg.floor(field)` · `$agg.first(field)` · `$agg.last(field)`

If you need those shapes on Postgres, drop to `selectRaw` / `havingRaw` with explicit SQL (e.g. `array_agg(DISTINCT …)`, a window function).

### Driver-specific escape hatch

When `$agg.*` can't express it, pass a raw expression in the same slot:

```ts
.groupBy("category", { total: "SUM(amount)" })          // Postgres
.groupBy("category", { total: { $sum: "$amount" } })    // MongoDB
```

Raw strings pass through verbatim. A MongoDB operator object passed on Postgres throws ("not portable to SQL") — keep raw expressions driver-correct.

## `.having(...)` — filter groups by a computed aggregate

`.where()` filters rows *before* grouping (cheap, uses indexes). `.having()` filters *after* aggregation, by the alias you defined:

```ts
const big = await Order.query()
  .groupBy("category", { total: $agg.sum("amount") })
  .having("total", ">", 1000)
  .get();
```

Works identically on both drivers. (Internally Postgres can't reference a SELECT alias in `HAVING`, so Cascade substitutes the underlying expression for you.) `having` accepts the same shapes as `where`: `having("total", 1000)`, `having("total", ">", 1000)`, `having({ total: 1000, orders: 5 })`. A `having()` on a **grouped column** (not an aggregate alias) is left as a plain column filter.

## OrderBy on aggregates

```ts
await Order.query()
  .groupBy("category", { revenue: $agg.sum("amount") })
  .orderBy("revenue", "desc")
  .get();
```

The `orderBy` reference matches the alias from the aggregates object.

## Gotchas

- **`where` vs `having`.** Row filters go in `.where()` (before grouping, index-friendly); aggregate filters go in `.having()`.
- **Empty sets.** Scalar terminators return `0` on zero rows (above). For *grouped* reports, a group with no rows simply doesn't appear — a report over an empty range returns `[]`, not a row of zeros.
- **Don't `.all()` then `array.reduce`.** Always push aggregates to the database.

## See also

- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — the broader query vocabulary
- [`@warlock.js/cache/use-cached-hof/SKILL.md`](@warlock.js/cache/use-cached-hof/SKILL.md) — caching expensive aggregate results
