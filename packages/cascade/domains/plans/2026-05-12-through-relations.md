# 2026-05-12 — Through relations — hasManyThrough / hasOneThrough

**Status:** not-started
**Severity:** S3 (Medium)
**Estimated effort:** 4 days
**Context:** Audit findings 2026-05-12. Common shape (Country → Posts through Users) requires raw SQL or composed `whereHas` today.

## Why

Through-relations skip an intermediate table:

- `Country` has many `Post`s **through** `User` — `users.country_id` + `posts.user_id`
- `Organization` has one `BillingPlan` **through** `Subscription` — single chain hop
- `Project` has many `Tasks` through `Sprints` — typical SaaS schema

Today: write raw SQL or chain `whereHas`. Both are awkward and don't compose with `withCount` / `joinWith`.

Laravel ships `hasManyThrough` / `hasOneThrough`. Cascade missing it forces every two-hop relation to be hand-coded.

## Scope

**In:** Two-hop through relations. `hasManyThrough` / `hasOneThrough` factories. RelationLoader integration. Postgres `joinWith` and `withCount` integration.

**Out:** N-hop chains (3+ tables) — no real demand, defer until asked. `belongsToThrough` (inverse) — defer; rare.

## Tasks

- [ ] Add `hasManyThrough(model, through, options?)` factory in [`helpers.ts`](../../../@warlock.js/cascade/src/relations/helpers.ts):
  - `model` = final target model name (e.g. "Post")
  - `through` = intermediate model name (e.g. "User")
  - `options` = `{ firstKey?, secondKey?, localKey?, secondLocalKey? }` per Laravel naming
- [ ] Add `hasOneThrough(model, through, options?)` (same signature; returns single instead of array)
- [ ] Extend [`RelationDefinition`](../../../@warlock.js/cascade/src/relations/types.ts):
  - `through?: string` — intermediate model name
  - `firstKey?` — FK on intermediate pointing to self
  - `secondKey?` — FK on target pointing to intermediate
  - `secondLocalKey?` — PK on intermediate
- [ ] Extend `RelationType` union with `"hasManyThrough" | "hasOneThrough"`
- [ ] Implement `loadHasManyThrough` in `RelationLoader`:
  - **Strategy: single SQL with JOIN over two tables** (one round-trip beats two queries)
  - `SELECT <target>.*, <intermediate>.<firstKey> AS __via FROM <target> INNER JOIN <intermediate> ON ... WHERE <intermediate>.<firstKey> IN (...)`
  - Group by `__via` value to assign back to source models
- [ ] Implement `loadHasOneThrough` similarly (limit per group via window function or post-processing)
- [ ] Implement Postgres `joinWith` through cases — chained LEFT JOIN
- [ ] Implement `withCount` through cases — count subquery with INNER JOIN to intermediate
- [ ] Implement `whereHas` through cases — EXISTS with chained join
- [ ] Default-key conventions snake_case (depends on [`fk-default-centralisation`](./2026-05-12-fk-default-centralisation.md))
- [ ] Type-check, format, demo

## Key implementation notes

### SQL shape for hasManyThrough

`Country.hasManyThrough("Post", "User")` expanded:

```sql
-- Loading via with():
SELECT
  "posts".*,
  "users"."country_id" AS "__via"
FROM "posts"
INNER JOIN "users" ON "users"."id" = "posts"."user_id"
WHERE "users"."country_id" IN ($1, $2, ...);

-- joinWith():
SELECT "countries".*,
  json_agg(...subquery...) AS "posts"
FROM "countries"
-- subquery joins users + posts
```

### Default key resolution (from Laravel convention)

```
hasManyThrough(model, through, {
  firstKey:        // FK on `through` pointing to self  → {selfModel}_id
  secondKey:       // FK on `model` pointing to through → {throughModel}_id
  localKey:        // PK on self                         → "id"
  secondLocalKey:  // PK on through                      → "id"
})
```

All defaults route through the centralised key-conventions helper from #2.

### Why prefer single SQL over two queries

Two-query approach: load intermediates first, collect their PKs, then load targets. That's 2 round-trips. Single JOIN is one round-trip. JOIN wins unless the intermediate is huge AND the join multiplies row count badly — for hasManyThrough that's not typical because we're filtering by source-FK.

### Counting via through

```sql
-- withCount("posts") on Country
(SELECT COUNT(*)
   FROM "posts"
   INNER JOIN "users" ON "users"."id" = "posts"."user_id"
   WHERE "users"."country_id" = "countries"."id")::int AS "postsCount"
```

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Through chain depth — 2-hop only or N-hop? | **2-hop v1.** N-hop has no real consumer; can extend if needed. |
| 2 | Default keys — Laravel naming or new? | **Laravel naming** (`firstKey`/`secondKey`/`localKey`/`secondLocalKey`). Familiar to anyone with prior ORM experience. |
| 3 | Single-JOIN load or two-query load? | **Single-JOIN.** One round-trip; planner-friendly. |
| 4 | Support `belongsToThrough` (inverse direction)? | **Defer.** Rare in real schemas; can be expressed via two `belongsTo` chains. |

## Verification

- [ ] Demo case: define `Country` + `User` + `Post` chain (or use existing models if a chain exists), exercise `hasManyThrough`
- [ ] `Country.with("posts").get()` returns expected groupings
- [ ] `Country.withCount("posts").get()` returns expected counts
- [ ] `Country.joinWith("posts").get()` returns chained JOIN result
- [ ] tsc clean

## Summary

_To be filled on completion._
