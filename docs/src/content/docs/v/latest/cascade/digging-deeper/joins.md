---
title: "Joins"
sidebar:
  order: 7
  label: "Joins"
---

Cascade has two ways to fetch data from more than one table in a single query:

- **Relation-driven loading** — `Model.with("relation")` or `Model.joinWith("relation")` — for connections you've declared with `@BelongsTo` / `@HasMany` / etc. on the model. Covered in [Relationships essentials](../the-basics/03-relationships.md).
- **Ad-hoc joins** — `.join()`, `.leftJoin()`, `.rightJoin()`, `.innerJoin()`, `.fullJoin()`, `.crossJoin()`, `.joinRaw()` — for one-off cross-table queries where the join isn't a declared relation.

This guide covers the second kind. Reach for it when you're writing reports, analytics, or cross-table aggregates where models don't yet know about each other.

:::tip — Relation-driven or ad-hoc?

If the two tables are connected by a declared relation, prefer `.with()` or `.joinWith()`. They hydrate the result into proper model instances, respect your decorator-declared relations, and compose naturally with the rest of the relations API.

Ad-hoc joins (this page) are right for queries that don't fit relations cleanly — denormalised reports, cross-table counts, joins to tables that have no Cascade model, exploratory analytics.

:::

## The basic case

```ts
const rows = await User.query()
  .join("profiles", "id", "user_id")
  .select(["users.name", "profiles.bio"])
  .get();
```

What's happening:

- `.join(table, localField, foreignField)` adds an INNER JOIN (on SQL) or a `$lookup` stage (on MongoDB).
- `localField` is from the current table — `users.id`.
- `foreignField` is from the joined table — `profiles.user_id`.
- `.select([...])` is what's projected back. Without it, the result shape is driver-dependent — explicit `.select()` is the safe default for joined queries.

The result is an array of plain rows (not hydrated `User` instances), because the join doesn't know it's reading users — it's reading a synthesised row shape.

## The join family

### `.join()` — default

```ts
User.query().join("profiles", "id", "user_id").get();
```

**Driver behavior diverges here**, so read carefully:

- **SQL (Postgres)** → emits `INNER JOIN`. Rows without a matching profile are excluded.
- **MongoDB** → emits `$lookup`, which is *inherently a left outer join*. Rows without a matching profile are included with an empty array.

If you mean "INNER JOIN" semantically — only return rows that have a match — use `.innerJoin()` explicitly. On MongoDB it adds the `$match` that filters out empty joins.

### `.leftJoin()` — keep all left rows

```ts
User.query().leftJoin("profiles", "id", "user_id").get();
```

Keeps every user; profile columns are `NULL` (SQL) or an empty array (MongoDB) for users without a profile. This is the most predictable join across drivers — both implementations behave the same way.

### `.innerJoin()` — explicit INNER

```ts
User.query().innerJoin("profiles", "id", "user_id").get();
```

Only returns rows where both sides match. On MongoDB this is `$lookup` followed by a `$match` that filters out documents with empty joined arrays. Use this when you need cross-driver INNER JOIN semantics — `.join()` doesn't give them.

### `.rightJoin()` — keep all right rows

```ts
User.query().rightJoin("profiles", "id", "user_id").get();
```

:::caution — MongoDB silently emulates this as LEFT JOIN

`$lookup` is one-directional (always left-flavored from the input collection). When you call `.rightJoin()` on MongoDB, Cascade falls back to a left join with the same fields — *not* the semantic you asked for.

If you genuinely need RIGHT JOIN semantics on MongoDB, restructure the query to put what you want as the "right side" as the *primary* collection instead, and use `.leftJoin()`.

:::

On SQL drivers, `.rightJoin()` emits a real `RIGHT JOIN`.

### `.fullJoin()` — full outer

```ts
User.query().fullJoin("profiles", "id", "user_id").get();
```

:::caution — MongoDB silently emulates this as LEFT JOIN

MongoDB has no native FULL OUTER JOIN. Cascade falls back to a left join — again, *not* what you asked for. For true full-outer semantics on MongoDB you need `$unionWith` + dedup logic, which sits outside the structured join methods (see [`.joinRaw()`](#joinraw--escape-hatch) below).

:::

On SQL drivers, `.fullJoin()` emits a real `FULL OUTER JOIN`.

### `.crossJoin()` — Cartesian product

```ts
Product.query().crossJoin("colors").get();
```

Every row on the left × every row on the right. Use sparingly:

:::caution — Cross joins grow fast

A cross join between two 10k-row tables produces 100M rows. Make sure you actually want every combination — and even then, consider `.limit()`.

:::

On SQL, this emits `CROSS JOIN`. On MongoDB, Cascade emulates by adding a `$lookup` with `_crossJoinDummy` placeholder fields and a `{ $match: {} }` pipeline that matches every document. Same semantic, different mechanics.

### The options-object form

Every join method also accepts a structured `JoinOptions` object instead of positional args. Useful when you need projection, aliasing, or driver-specific extras:

```ts
User.query().join({
  table: "profiles",
  localField: "id",
  foreignField: "user_id",
  alias: "profile",       // alias the joined relation
  select: ["bio", "avatar"], // project only these columns from profiles
});
```

The shape — see `JoinOptions` in the reference — supports `alias`, `type`, `select`, `conditions`, plus driver-specific `pipeline` (MongoDB) and `options` slots.

## Decision table — which join to reach for

| Situation | Reach for |
| --------- | --------- |
| INNER semantics across both drivers | `.innerJoin()` |
| Keep all left + matches (most predictable cross-driver) | `.leftJoin()` |
| Keep all right + matches | `.rightJoin()` — **SQL only**, silently emulated on MongoDB |
| Everything from both sides | `.fullJoin()` — **SQL only**, silently emulated on MongoDB |
| Every combination | `.crossJoin()` — supported on both, used sparingly |
| Driver-specific shape Cascade can't express | `.joinRaw()` |
| The tables are connected by a declared relation | `.with()` / `.joinWith()` — see [Relationships](../the-basics/03-relationships.md) |
| Not sure | `.leftJoin()`. It's the only join that behaves the same on both drivers. |

## `.joinRaw()` — escape hatch

For joins the structured methods can't express. Two genuine use cases:

```ts
// SQL: lateral join — no structured equivalent in Cascade
query.joinRaw(
  "LEFT JOIN LATERAL (SELECT * FROM events WHERE events.user_id = users.id ORDER BY ts DESC LIMIT 1) e ON true"
);

// MongoDB: $graphLookup — recursive lookup, not $lookup at all
query.joinRaw({
  $graphLookup: {
    from: "categories",
    startWith: "$parent_id",
    connectFromField: "parent_id",
    connectToField: "_id",
    as: "ancestors",
  },
});
```

`.joinRaw()` accepts a SQL fragment + bindings (SQL drivers) or an aggregation stage object (MongoDB). Whatever you pass goes through verbatim — no wrapping, no rewriting.

:::tip — `.joinRaw()` is the escape hatch, not the typical MongoDB path

If you find yourself writing `{ $lookup: { from, localField, foreignField, as } }` inside `.joinRaw()`, you almost certainly want `.leftJoin({ table, ... })` instead — that's what the structured method emits anyway. Reach for `.joinRaw()` when the stage you need *isn't* `$lookup` (e.g. `$graphLookup`, `$unionWith`, `$facet`) or when the SQL needs lateral / cross-apply / similar.

:::

## Multi-table joins

Chain `.join()` / `.leftJoin()` calls for queries spanning three or more tables:

```ts
const rows = await User.query()
  .leftJoin("posts", "id", "author_id")
  .leftJoin("comments", "posts.id", "post_id")
  .where("users.status", "active")
  .select(["users.name", "posts.title", "comments.body"])
  .get();
```

Each call adds another join. Filters and ordering can reference any joined table — but on SQL, the columns get qualified (`users.status` rather than `status`) when there's ambiguity. Cascade doesn't auto-qualify; you do.

:::tip — at 4+ joins, reconsider

If a single query has four or more joins, ask whether ad-hoc joins are still the right shape. Reporting tools, materialised views, and dedicated analytics tables (with denormalised data) are usually cheaper to maintain than a one-screen-wide query.

:::

## Joins + the rest of the query API

Every method from the [Querying essentials](../the-basics/02-querying.md) page works alongside joins — `.where()`, `.orderBy()`, `.groupBy()`, `.paginate()`, all of it. Filter columns get qualified with the table name when ambiguous:

```ts
const rows = await User.query()
  .leftJoin("posts", "id", "author_id")
  .where("users.status", "active")
  .where("posts.created_at", ">=", lastWeek)
  .orderBy("users.name", "asc")
  .paginate({ page: 1, limit: 20 });
```

## Driver caveats — single reference

| Method | SQL (Postgres) | MongoDB |
| ------ | -------------- | ------- |
| `.join()` | INNER JOIN | LEFT-flavored `$lookup` (different default!) |
| `.leftJoin()` | LEFT JOIN | `$lookup` (native left semantics) |
| `.rightJoin()` | RIGHT JOIN | **Silently emulated as LEFT** ⚠️ |
| `.innerJoin()` | INNER JOIN | `$lookup` + `$match` to drop empty joins |
| `.fullJoin()` | FULL OUTER JOIN | **Silently emulated as LEFT** ⚠️ |
| `.crossJoin()` | CROSS JOIN | Emulated via `$lookup` + `$match: {}` |
| `.joinRaw()` | Raw SQL fragment + bindings | Raw aggregation stage object |

The rows with ⚠️ are the silent-semantic-mismatch footguns. If your code base targets both drivers — or might in the future — use `.leftJoin()`/`.innerJoin()` for cross-driver correctness, and lean on `.joinRaw()` when you need stronger SQL-side semantics.

## Going further

- **Relation-driven loading** for declared connections: [Relationships essentials](../the-basics/03-relationships.md), [Relationships guide](./relationships.md)
- **Aggregation across joined tables** (counts, sums, averages by group): [Aggregates guide](./aggregates.md)
- **Complex MongoDB pipelines** (`$graphLookup`, `$facet`, `$unionWith`): [Expressions guide](./expressions.md)
- **The full `JoinOptions` shape**: [Query Builder API reference](../reference/query-builder-api.md)
