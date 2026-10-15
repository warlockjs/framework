# 2026-05-12 — Move eager-load hook from buildQuery into QueryBuilder.get()

**Status:** completed
**Severity:** S3 (Medium)
**Estimated effort:** 0.5 day
**Completed:** 2026-05-12
**Context:** Audit findings 2026-05-12. Fragility around `Model.newQueryBuilder()` bypass.

## Why

Eager-loading via `with()` is currently wired in [`buildQuery`](../../../@warlock.js/cascade/src/model/methods/query-methods.ts:40-54):

```ts
queryBuilder.onFetched(async (models: any[]) => {
  const eagerRelations = qb.eagerLoadRelations;
  if (eagerRelations && eagerRelations.size > 0 && models.length > 0) {
    const loader = new RelationLoader(models, ModelClass as any);
    await loader.load([...eagerRelations.keys()], constraints);
  }
});
```

This means **only builders constructed via `Model.query()` install the eager-load hook**. Any code that:

- Calls `Model.newQueryBuilder()` directly (e.g. for testing or custom flows)
- Subclasses the query builder via `static builder = ...`
- Uses the driver's `dataSource.driver.queryBuilder(table)` directly

...gets a builder that records `eagerLoadRelations` via `with()` but **never executes the loader**. The relations are silently never loaded, models come back without `.posts` populated.

This is a footgun-by-omission rather than a hot bug, but it's exactly the kind of "magic-elsewhere" wiring that breaks in non-obvious ways.

## Scope

**In:** Move the eager-load invocation into the driver's `get()` method (and other terminals: `first`, `paginate`) so it runs regardless of how the builder was constructed.

**Out:** Async chain ordering for user-supplied `onFetched` hooks. Remove `onFetched` API entirely (still useful for other purposes).

## Tasks

- [ ] Identify all driver `get()` paths:
  - [`PostgresQueryBuilder.get()`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts) line 524
  - MongoDB driver equivalent
- [ ] Add eager-load invocation to `get()`, after hydration but BEFORE the user's `fetchedCallback` (so user's onFetched sees fully-loaded models)
- [ ] The driver needs `relationDefinitions` + `modelClass` from builder state — already present (set by `buildQuery`), but make the resolution defensive: skip silently if `modelClass` missing (e.g. raw driver-level `queryBuilder()` calls without a model context)
- [ ] Remove the `onFetched` registration from [`buildQuery`](../../../@warlock.js/cascade/src/model/methods/query-methods.ts:40-54) — replaced by driver-level invocation
- [ ] Audit any other consumers of `eagerLoadRelations` to ensure they still work
- [ ] Type-check, format

## Key implementation notes

### Order: eager-load before vs after user's fetchedCallback?

User's `fetchedCallback` fires after `hydrateCallback`. Eager-load mutates the model instances by attaching `loadedRelations` + setting properties. Two orders:

- **(a) eager → user.fetchedCallback** — user sees loaded models, can read `.posts`. Most natural.
- **(b) user.fetchedCallback → eager** — user sees raw models, can mutate before loading.

**Recommend (a).** Matches what users assume from `with()`. (b) would surprise.

### Skip silently when modelClass absent

A raw `dataSource.driver.queryBuilder(table)` has no model context. If someone calls `.with("foo")` on it, there's no relation map to consult. Skip the loader (don't throw) — the `with()` call was nonsensical anyway, the user owns it.

### Idempotency

`get()` already mutates state (clears `operations` at line 560). Adding eager-load here doesn't introduce new idempotency concerns — `get()` is fundamentally non-idempotent.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Eager-load in `get()` or in a higher-level wrapper? | **In `get()`.** That's where models become available; eager-load needs them. |
| 2 | Order vs user's `fetchedCallback`? | **Eager first, then user.** User sees loaded models; matches mental model. |
| 3 | Throw or skip when `modelClass` missing? | **Skip silently.** Raw driver-level usage doesn't have a relations map. |
| 4 | Also fix MongoDB driver in this plan? | **Yes.** Same bug surface. |

## Verification

- [ ] `Model.newQueryBuilder().with("posts").get()` (bypassing `Model.query()`) now loads posts — previously silent no-op
- [ ] Existing `Model.query().with("posts").get()` flow unchanged — still loads posts
- [ ] User's `onFetched` callback sees fully-loaded models
- [ ] tsc clean

## Summary

Eager-loading invocation moved from the `buildQuery`-installed `onFetched` callback into the Postgres driver's `get()` method via a new `applyEagerLoading(records)` private method.

**Why it matters.** Previously, only builders constructed via `Model.query()` / `buildQuery` had the loader hook installed. Any other path — `Model.newQueryBuilder()` direct, custom subclassed builders via `static builder`, raw driver-level usage — made `with()` a silent no-op.

**Implementation:**
- `applyEagerLoading(records)` lives on `PostgresQueryBuilder` and runs after `attachJoinedRelations` and before the user's `fetchedCallback`. The user therefore sees fully-loaded models in their onFetched hook.
- Skipped silently when `modelClass` is absent (raw driver-level `queryBuilder()` usage has no relations map).
- `buildQuery`'s onFetched callback now just emits the model-level `fetched` event — the loader duplication was deleted.
- Unused `RelationLoader` import dropped from `query-methods.ts`.

**Order in get():** scopes → joinWith expansion → joinRelations → hasRelations → countRelations → query → hydrate → attachJoinedRelations → applyEagerLoading → user's fetchedCallback.
