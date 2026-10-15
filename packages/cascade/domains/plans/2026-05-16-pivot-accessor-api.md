# 2026-05-16 — Unify pivot operations under `model.pivot(relation)`

**Status:** proposed — design decided by Hasan 2026-05-16
**Owner:** Hasan
**Type:** API consolidation — single pivot accessor, removes a naming collision
**Docs treatment:** documented **as-if-shipped** in `essentials/03-relationships.md` + `guides/relationships.md` (the established pattern, e.g. `npx cascade migrate`). Tracked in `2026-05-06-docs-rewrite/engineering-tasks.md`.

## The problem

The pivot mutation surface is currently split and collides with an unrelated feature:

1. **Split surface.** `model.attach(relation, ids, pivotData?)` and `model.detach(relation, ids?)` exist as model methods (`model.ts:1771` / `:1788`, thin wrappers over `createPivotOperations`). `sync` and `toggle` do **not** — they only exist on the `PivotOperations` object reachable via `createPivotOperations(model, relation)`. So a developer learns `post.attach(...)` then can't find `post.sync(...)`.

2. **Naming collision.** `Model.sync(TargetModel, field)` (`model.ts:716`) is the **denormalization-embed** feature (refresh embedded copies when the source changes — see `guides/sync.md`). A pivot `model.sync("tags", ids)` would read as the same verb for a completely different operation. Confusing in autocomplete, confusing in code review, confusing in the docs.

## The decision

**All pivot mutations go through one accessor: `model.pivot(relation)`**, which returns the `PivotOperations` object. Every operation is called off it:

```ts
await post.pivot("tags").attach([1, 2, 3]);
await post.pivot("tags").attach([4], { addedBy: currentUserId });
await post.pivot("tags").detach([2]);
await post.pivot("tags").detach();              // detach all
await post.pivot("tags").sync([1, 3, 5]);       // replace whole set
await post.pivot("tags").toggle([1, 7]);        // flip each
```

- `model.pivot(relation).sync(...)` can never be confused with `Model.sync(Target, field)` — the `.pivot("tags")` qualifier makes the domain explicit at the call site.
- One place to learn, one place to autocomplete, complete operation set (`attach`/`detach`/`sync`/`toggle` — `PivotOperations` already implements all four; verified `pivot-operations.ts:127/166/197/244`).

## What needs to ship

Small — the operations object already exists and already validates the relation type.

1. **Add `Model.pivot(relation)`** — a thin accessor:

   ```ts
   // model.ts
   public pivot(relation: string): PivotOperations {
     return createPivotOperations(this, relation);
   }
   ```

   `createPivotOperations` is already exported from `@warlock.js/cascade` (via the relations barrel) and its `PivotOperations` constructor already throws when `relation` is not a `belongsToMany` (`pivot-operations.ts:88-93`) — so `post.pivot("author").attach(...)` (a `belongsTo`) throws with a clear message. No extra validation needed.

2. **Remove the direct `model.attach()` / `model.detach()` methods** (`model.ts:1771`, `:1788`). They are superseded by `model.pivot(relation).attach/detach`. This is the breaking part of the change — but the surface is new enough that the blast radius is small, and keeping both forms would re-introduce the very inconsistency this task removes.

   - The underlying `attachPivotRelation` / `detachPivotRelation` helpers can stay or fold back into `PivotOperations`; that's an internal cleanup detail, not part of the contract.

3. **`createPivotOperations(model, relation)` stays exported** as the lower-level/standalone entry point (tests, code that grabs the ops object once). `model.pivot(relation)` is the ergonomic front for it — exactly the `transaction()` ↔ `getDatabaseDriver().transaction()` relationship.

## Test coverage

Mirror the existing pivot-operations specs but drive through `model.pivot(relation)`:

- `model.pivot("tags").attach/detach/sync/toggle` happy paths against a real `belongsToMany` (assert pivot rows after).
- `model.pivot("author")` where `author` is `belongsTo` → throws the not-belongsToMany error.
- Regression guard: the removed `model.attach` / `model.detach` are gone (a call site using the old form fails to compile — intended).
- Disambiguation smoke: `Model.sync(Target, field)` (denormalization) and `model.pivot(rel).sync(ids)` (pivot) coexist with no shadowing.

## Docs impact (apply now, as-if-shipped)

- `essentials/03-relationships.md` + `guides/relationships.md`: pivot section uses `model.pivot("tags").attach/detach/sync/toggle(...)` uniformly. No more "attach/detach on the model, sync/toggle via createPivotOperations" split — that split only existed because the API was mid-evolution.
- `guides/sync.md`: add one sentence disambiguating `Model.sync()` (embed refresh) from `model.pivot(rel).sync()` (pivot set-replace) so a reader who lands on either doesn't conflate them.

## When this ships

- Remove the engineering-task entry.
- The docs already match the target API — no doc rewrite needed at ship time, only delete this plan file.

## Out of scope

- Reading pivot-row extra columns back onto the loaded related instances (separate, larger concern — noted in the relationships guide already).
- `Pivot extends Model` promotion (`2026-05-12-pivot-as-model.md` in the backlog) — independent.
