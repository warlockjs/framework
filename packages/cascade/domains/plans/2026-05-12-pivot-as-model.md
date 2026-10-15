# 2026-05-12 — Pivot promotion — allow real Models as the pivot

**Status:** not-started
**Severity:** S3 (Medium)
**Estimated effort:** 2 days
**Context:** Audit findings 2026-05-12. `belongsToMany` always treats pivot as a raw table; can't have extra columns + behaviour on the join.

## Why

`loadBelongsToMany` calls [`dataSource.driver.queryBuilder(pivotTable)`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:352) directly — bypasses the model layer (no scopes, no events, no validation, no hydration). That's correct for raw pivot rows but means:

- Extra pivot columns (e.g. `role`, `joined_at`, `is_admin`) can't be validated
- No lifecycle events fire when pivot rows are created (audit logging breaks)
- No accessors on pivot data (e.g. `pivot.assignedAt` returning a Date)
- Soft-delete on pivot is impossible (no global scope)

ActiveRecord's `has_many :through` lets the pivot be a real model. Cascade lacks the equivalent.

## Scope

**In:** Allow `belongsToMany` to accept a Model class (not just a table name) as the pivot. When provided, route pivot operations through that model's `query()` so it gets scopes/events/hydration/validation. Surface pivot data on the loaded related instance via a `pivot` accessor.

**Out:** A whole new `belongsToManyThrough` relation type (the existing `belongsToMany` is extended, not replaced). Auto-generation of pivot Models from a string.

## Tasks

- [ ] Extend [`BelongsToManyOptions`](../../../@warlock.js/cascade/src/relations/types.ts) — `pivot` accepts `string | typeof Model`
- [ ] Extend `RelationDefinition.pivot` accordingly
- [ ] Update [`loadBelongsToMany`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:323) — when pivot is a Model class:
  - Use `PivotModel.query().whereIn(...)` instead of raw driver query
  - Apply pivot model's global scopes (e.g. soft-delete)
  - Hydrate pivot rows as instances
  - Attach the pivot instance as `relatedInstance.pivot` (or `_pivot` to avoid collisions)
- [ ] Update [`PivotOperations`](../../../@warlock.js/cascade/src/relations/pivot-operations.ts) (attach/detach/sync/toggle):
  - Use `PivotModel.create(...)` for inserts (fires `created` event, applies validation)
  - Use `PivotModel.deleteOne(...)` for removes (fires `deleted` event)
  - Fall back to raw driver when pivot is a string (backward compat)
- [ ] Add `withPivot(...columns: string[])` builder method to opt into specific pivot columns being attached to the related instance. Default = all pivot columns when pivot is a Model; only join keys when pivot is a string (current behaviour).
- [ ] Update Postgres `joinWith` for belongsToMany — when constraint targets pivot columns AND pivot is a Model, qualify by pivot table; document the limitation
- [ ] Type-check, format, demo

## Key implementation notes

### Pivot accessor on related

```ts
const post = await Post.query().with("tags").first();
const tag = post.tags[0];
tag.name;         // "javascript"
tag.pivot.role;   // "primary" — pivot column
tag.pivot.createdAt; // Date — pivot accessor
```

### Backward-compat for string pivot

`belongsToMany("Tag", { pivot: "post_tags", ... })` keeps working. Internal logic checks `typeof pivot === "string"` vs class.

### Why not auto-generate the pivot Model from a string?

It would invent table-derived models behind the user's back — confusing when the pivot has constraints, indexes, or non-trivial columns. Force users to create the pivot Model when they want model-level behaviour.

### `withPivot()` API

Mirrors Laravel's `->withPivot('column1', 'column2')`. Without it, only join keys come back. With it, named columns surface on `pivot.<col>`.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | `relatedInstance.pivot` or `_pivot` as accessor name? | **`pivot`.** Matches Laravel; clean DX. Document collision risk if a model field is also named `pivot`. |
| 2 | Auto-generate pivot Model from table string? | **No.** Explicit-only. Avoids surprise schema. |
| 3 | Default `withPivot` columns when pivot is a Model? | **All columns.** When pivot is a string, only join keys (current behaviour). |
| 4 | Pivot Model's events fire on attach/detach? | **Yes.** That's the whole point of promoting it. |

## Verification

- [ ] Demo: define a `UserRole` pivot Model with extra `assignedAt` column, attach via belongsToMany, verify hydration
- [ ] Pivot soft-delete via global scope works
- [ ] String-pivot path still works unchanged (regression check)
- [ ] tsc clean

## Summary

_To be filled on completion._
