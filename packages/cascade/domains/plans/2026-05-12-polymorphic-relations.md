# 2026-05-12 — Polymorphic relations — morphTo / morphMany / morphOne

**Status:** not-started
**Severity:** S3 (Medium)
**Estimated effort:** 1 week
**Context:** Audit findings 2026-05-12. Common shape (comments, attachments, reactions, audit logs) currently requires JSON columns or duplicated tables.

## Why

Polymorphic relations let one table reference many parent tables via a `(type, id)` pair. Examples:

- `Comment` can belong to `Post` OR `Video` OR `Photo` — `comments` table has `commentable_type` + `commentable_id`
- `Upload` can attach to any model — `uploads` has `attachable_type` + `attachable_id`
- `Reaction` can target any thing — `reactions` has `reactable_type` + `reactable_id`

Cascade has zero support today. Grep `morphMany|morphTo|polymorphic` returns no matches. Workarounds in the codebase: JSON columns or per-parent-type tables.

Laravel/ActiveRecord ship this; modern TypeScript ORMs (Drizzle, Prisma) do too. Cascade missing it is a real positioning gap.

## Scope

**In:** `morphTo`, `morphMany`, `morphOne` factories. RelationLoader + Postgres `joinWith`/`withCount` integration. Snake_case `${name}_type` + `${name}_id` column convention.

**Out:** `morphToMany` / `morphedByMany` (polymorphic many-to-many) — defer to v2. Custom morph maps (e.g. mapping `"Post"` → integer 1 in the column) — defer; v1 stores the registered model name as a string.

## Tasks

- [ ] Extend [`RelationDefinition`](../../../@warlock.js/cascade/src/relations/types.ts) with `morphType?: string` (column holding type) and treat `model` as optional for `morphTo`
- [ ] Add `morphTo(name: string, options?: { type?: string; id?: string })` factory — defaults to `${name}_type` and `${name}_id`
- [ ] Add `morphMany(model: string, name: string, options?: ...)` factory — `name` is the morph name (used to derive column names on the related side)
- [ ] Add `morphOne(model: string, name: string, options?: ...)` factory
- [ ] Extend [`RelationType`](../../../@warlock.js/cascade/src/relations/types.ts) union with `"morphTo" | "morphMany" | "morphOne"`
- [ ] Implement `loadMorphTo` in `RelationLoader`:
  - Group models by their `_type` value
  - For each type, resolve the model class from registry, batch-load by `_id`
  - Index back per model
- [ ] Implement `loadMorphMany` / `loadMorphOne`:
  - Single batch query: `whereIn(morphIdCol, ids).where(morphTypeCol, selfModelName)`
- [ ] Implement Postgres `joinWith` morph cases — for `morphTo`, can't JOIN (multi-target); throw a clear "use `with()` for polymorphic morphTo" error. For `morphMany`/`morphOne`, JOIN with the morph-type filter in the ON clause.
- [ ] Implement `withCount` morph cases (subquery with morph filter)
- [ ] Implement `whereHas` morph cases (after [`wherehas-family`](./2026-05-12-wherehas-family.md) lands)
- [ ] Document the morph-type stored value: registered model class name (matches `getModelFromRegistry` lookup key)
- [ ] Type-check, format, demo

## Key implementation notes

### Storage convention

```ts
// Comment model
static relations = {
  commentable: morphTo("commentable"),
};

// Post model
static relations = {
  comments: morphMany("Comment", "commentable"),
};
```

Comments table: `commentable_type` ("Post" / "Video" / ...) + `commentable_id` (int/uuid).

### Why morphTo can't join

`Post.joinWith("comments")` works — single target table.

`Comment.joinWith("commentable")` doesn't — `commentable` could resolve to multiple tables. PG can't join to a dynamic target. Force `with()` for the eager path.

### Migration impact

This is purely additive at the type level — existing models keep working. Migrations to add morph columns are app-level concerns, not framework code.

### Custom morph maps (deferred)

Laravel lets you map `"Post"` → `"posts"` or even `"1"` to keep `_type` columns short. Defer until a real consumer asks. v1 = store the registered class name verbatim.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Default column suffix `_type`/`_id` or configurable convention? | **`_type` + `_id`.** Match Laravel/Rails. Configurable per-relation via options. |
| 2 | `_type` value: model class name, table name, or custom string? | **Class name** — directly maps via `getModelFromRegistry`. |
| 3 | `morphTo` joinWith — error or fall back to with()? | **Throw** with a clear message pointing to `with()`. Fallback magic hides cost. |
| 4 | Eager-load N model types in `loadMorphTo` — sequential or parallel? | **Parallel** via `Promise.all`. Each is an independent query against a different table. |

## Verification

- [ ] Demo case: model defines `morphTo` + `morphMany` pair, `with()` resolves both directions
- [ ] `withCount("comments")` on a polymorphic parent emits filter on `_type`
- [ ] `joinWith("commentable")` throws the expected error
- [ ] tsc clean, format

## Summary

_To be filled on completion._
