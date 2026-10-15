---
title: "Reporting queries"
sidebar:
  order: 11
  label: "Reporting queries"
---

A reporting service is `groupBy` + `$agg` + `having` + `orderBy` in one chain, returned as a plain shape the caller renders. Plain query builder — no analytics engine, no materialized views for the common cases.

## Revenue per category

```ts
import { $agg } from "@warlock.js/cascade";
import { Order } from "../models/order/order.model";

type CategoryReportRow = {
  category: string;
  revenue: number;
  orders: number;
};

export async function revenueByCategory(): Promise<CategoryReportRow[]> {
  return Order.query()
    .where("status", "completed")
    .groupBy("category", {
      revenue: $agg.sum("amount"),
      orders: $agg.count(),
    })
    .having("revenue", ">", 0)
    .orderBy("revenue", "desc")
    .get<CategoryReportRow>();
}
```

The chain in execution order: filter to completed orders, group by category, sum and count per group, drop empty groups, sort highest revenue first. `.get<CategoryReportRow>()` types the rows — each is `{ category, revenue, orders }`.

## Time-bucketed report — revenue per day

Grouping by a plain column won't bucket a timestamp into days. Use `groupByRaw` for the date expression, and a raw aggregate alias the report can sort on:

```ts
type DailyRevenueRow = {
  day: string;
  revenue: number;
};

export async function dailyRevenue(from: Date, to: Date): Promise<DailyRevenueRow[]> {
  return Order.query()
    .where("status", "completed")
    .whereBetween("createdAt", [from, to])
    .groupByRaw("DATE(created_at)")
    .groupBy("DATE(created_at)", {
      revenue: $agg.sum("amount"),
    })
    .orderBy("day", "asc")
    .get<DailyRevenueRow>();
}
```

`groupByRaw` is driver-specific — `DATE(created_at)` is Postgres. On MongoDB the date-bucket expression is a `$dateToString` stage; if the report must run on both drivers, branch the bucket expression by driver or keep reporting on the SQL side. Most apps run reporting against one database and don't need the abstraction here.

## Filtering on the aggregate — top performers

`having` filters groups by their aggregate result. "Categories that did more than 5000 in completed revenue, busiest first":

```ts
export async function topCategories(threshold: number): Promise<CategoryReportRow[]> {
  return Order.query()
    .where("status", "completed")
    .groupBy("category", {
      revenue: $agg.sum("amount"),
      orders: $agg.count(),
    })
    .having("revenue", ">", threshold)
    .orderBy("revenue", "desc")
    .limit(10)
    .get<CategoryReportRow>();
}
```

`having("revenue", ">", threshold)` references the aggregate alias. On Postgres, Cascade rewrites that to the underlying `SUM(amount)` expression automatically (a SELECT alias isn't legal in a raw SQL `HAVING`), so the same chain works on both drivers — see the [Aggregates guide](../digging-deeper/aggregates.md#filtering-grouped-results--having).

## A multi-metric dashboard query

One query, several metrics per group — the shape a dashboard endpoint returns:

```ts
type ProviderUsageRow = {
  provider: string;
  trips: number;
  totalInput: number;
  totalOutput: number;
  avgInput: number;
};

export async function providerUsage(): Promise<ProviderUsageRow[]> {
  return AiUsage.query()
    .groupBy("provider", {
      trips: $agg.count(),
      totalInput: $agg.sum("input_tokens"),
      totalOutput: $agg.sum("output_tokens"),
      avgInput: $agg.avg("input_tokens"),
    })
    .having("trips", ">", 0)
    .orderBy("totalInput", "desc")
    .get<ProviderUsageRow>();
}
```

Each metric is one entry in the aggregates object. The result rows carry exactly the keys you aliased plus the group field — no post-processing to reshape.

## Empty results

Per the [Aggregates guide](../digging-deeper/aggregates.md#empty-results-return-0-not-null): the simple terminators (`sum`/`count`/`avg`/`min`/`max`) return `0`, never `null`, when nothing matches. For *grouped* reports there's a different edge — a group with no rows simply doesn't appear in the result array. A report over a date range with no orders returns `[]`, not a row of zeros. Render the empty state from `rows.length === 0`, don't expect placeholder rows.

## Where this stops being a single query

This recipe is single-chain reporting. When the report needs window functions (running totals, rank-within-group), cross-table aggregates across several joins, or pre-computed rollups for performance, it's outgrown the query builder's reporting surface:

- **Window functions** — [Expressions guide](../digging-deeper/expressions.md) (`selectWindow`, raw `OVER (...)`).
- **Cross-table aggregates** — [Joins guide](../digging-deeper/joins.md) then group the joined shape.
- **Materialized rollups** — a scheduled job writing a summary table is cheaper to read than re-aggregating a large table per request; that's an architecture decision, not a query-builder feature.

## Going further

- **The aggregate vocabulary in full** — [Aggregates guide](../digging-deeper/aggregates.md)
- **Raw expressions and window functions** — [Expressions guide](../digging-deeper/expressions.md)
- **Every aggregate signature** — [Query Builder API reference](../reference/query-builder-api.md)
