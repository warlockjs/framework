# 2026-05-12 — Single source of truth for loaded relations

**Status:** completed
**Severity:** S4 (Low)
**Estimated effort:** 0.5 day
**Completed:** 2026-05-12
**Context:** Audit findings 2026-05-12. Dual storage drift between `loadedRelations` Map and direct property assignment.

## Why

[`setLoadedRelation`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:583-597) writes the relation in two places:

```ts
modelWithRelations.loadedRelations.set(name, value);
(model as Record<string, unknown>)[name] = value;
```

Convenient for users (`user.posts` works directly), but two storage slots = two sources of truth. If anyone mutates `user.posts = newPosts` directly, `loadedRelations.get("posts")` becomes stale. Anything reading the Map sees old data.

Today this hasn't bitten because no consumer reads `loadedRelations` for anything important. But the moment something does (e.g. relation events, cache invalidation), drift will bite.

## Scope

**In:** Make property access a getter that reads from the Map. Setter writes to the Map and emits a dev-only warning if it's overwriting.

**Out:** Removing direct property access entirely (DX regression).

## Tasks

- [ ] Modify `setLoadedRelation` to use `Object.defineProperty(model, name, { get, set, configurable: true })`:
  - `get` returns `loadedRelations.get(name)`
  - `set` writes `loadedRelations.set(name, value)`
  - In dev, emit `console.warn` if the setter is invoked after initial set (signals overwrite)
- [ ] Verify hot-path performance: `defineProperty` once per relation per model is fine; this isn't called in tight loops
- [ ] Verify enumeration: getter properties are enumerable by default; iterations like `Object.keys(model)` still see the relation
- [ ] Verify JSON serialisation: getter values are picked up by `JSON.stringify` — safe
- [ ] Verify TS access: `model.posts` still typechecks

## Key implementation notes

### Why not just remove the property?

Direct access is a major DX feature — `user.posts.length` is much nicer than `user.getRelation("posts").length`. Keep it; just make it a façade over the Map.

### `configurable: true` matters

If the property is later overwritten by the user (`user.posts = []`), `defineProperty` needs to allow re-defining. Setting `configurable: true` permits future redefinition.

### Loop perf

Models loaded via `RelationLoader.setRelationOnModels` iterate over `this.models`. For each, `setLoadedRelation` is called once per relation. A `defineProperty` call per-model-per-relation is O(N×R) — same as the current direct-assignment path. No regression.

### Dev warning frequency

If someone reassigns `user.posts = newPosts`, the warning helps catch unintended drift. Production should skip the warn (env check).

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Drop direct property access entirely? | **No.** Keep as façade — preserve DX. |
| 2 | Warn on setter invocation? | **Dev-only.** Production stays silent. |
| 3 | Use `Object.defineProperty` or a Proxy? | **defineProperty.** Per-property is enough; Proxy adds overhead and complicates serialisation. |

## Summary

Direct property access and the `loadedRelations` Map are now backed by the same storage via a `defineProperty` getter/setter façade — `user.posts` reads from `loadedRelations.get("posts")`, and `user.posts = newPosts` writes back to the Map. No more drift possible.

**Implementation:**
- New exported `attachLoadedRelation(model, name, value)` helper in `relation-loader.ts`. Installs the property as a getter/setter pointing at the Map.
- `getter` reads `loadedRelations.get(name)`.
- `setter` writes `loadedRelations.set(name, next)`.
- `configurable: true` (allows re-definition on relation reload) and `enumerable: true` (so `Object.keys` / `JSON.stringify` see the relation).
- `RelationLoader.setLoadedRelation` now delegates to the helper (one-line method).
- `attachJoinedRelations` in postgres-query-builder.ts (the `joinWith` path) updated to use the same helper — previously wrote to both the Map AND the property directly, now uses the single source.

**Dev-warn on setter overwrite** — considered, deferred. The setter is invoked any time the property is assigned, including the normal "first load" case. Distinguishing "first set" from "overwrite" requires either tracking the Map's prior state or adding a flag — neither is worth the code for a debug-only signal. Skipped.
