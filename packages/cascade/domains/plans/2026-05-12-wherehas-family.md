# 2026-05-12 — whereHas family — emit EXISTS subqueries

**Status:** completed
**Severity:** S1 (Critical)
**Estimated effort:** 1 day
**Started:** 2026-05-12
**Completed:** 2026-05-12
**Context:** Audit findings 2026-05-12. Same class of silent no-op as `withCount` was before [`ff3bdcc`](#).

## Why

`whereHas`, `has`, `orWhereHas`, `doesntHave`, `whereDoesntHave` are all:

- Listed in [`PostgresOperationType`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.ts) (lines 71-74)
- Exposed on [`QueryBuilderContract`](../../../@warlock.js/cascade/src/contracts/query-builder.contract.ts) (lines 1301-1379)
- Implemented as `addOperation(...)` pushes in [`query-builder.ts`](../../../@warlock.js/cascade/src/query-builder/query-builder.ts:948-980)

But the parser switch in [`processOperation`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.ts:296-417) has **zero `case` arms** for any of them. Grep:

```
grep -nE "processHas|processWhereHas|processDoesntHave|case \"has\"" postgres-query-parser.ts
→ No matches found.
```

Result: `User.query().whereHas("posts", q => q.where("isPublished", true))` runs as `SELECT * FROM "users"` — the `whereHas` is silently dropped. **Any query using these methods returns wrong data today.**

This was missed during the `withCount` audit because the symptom is identical (silent ignore) and the bug surface is wider.

## Scope

**In:** Postgres parser implementation for `has`, `whereHas`, `orWhereHas`, `doesntHave`, `whereDoesntHave`. All four relation types (`hasMany`/`hasOne`/`belongsTo`/`belongsToMany`).

**Out:** MongoDB driver (separate follow-up). `or` variants of `doesntHave`/`whereDoesntHave` (defer unless contract surfaces them).

## Tasks

- [ ] Audit `whereHas` storage: `addOperation("whereHas", { relation, subquery: sub.operations })` at [`query-builder.ts:957-961`](../../../@warlock.js/cascade/src/query-builder/query-builder.ts:957). Confirm sub.operations is an `Op[]`.
- [ ] Add `processHas(data, boolean)` to [`postgres-query-parser.ts`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.ts) — emits `EXISTS (SELECT 1 FROM <related> WHERE <fk> = <self>.<pk>)` (or `(SELECT COUNT(*) FROM <related> WHERE <fk> = <self>.<pk>) <op> <count>` when `op`/`count` present)
- [ ] Add `processWhereHas(data, boolean)` — like `processHas` but with the `subquery` ops appended to the inner WHERE via the existing `absorbSubParserParams` helper from [`a332816`](#)
- [ ] Add `processDoesntHave` — `NOT EXISTS (SELECT 1 FROM <related> ...)`
- [ ] Add `processWhereDoesntHave` — `NOT EXISTS` + sub-constraints
- [ ] Wire all four into `processOperation`'s switch
- [ ] Resolve relation defs the same way `applyJoinRelations`/`applyCountRelations` do — read `relationDefinitions` from somewhere accessible to the parser
- [ ] **Decide where relation resolution happens**: parser-side (parser needs access to `relationDefinitions`) OR builder-side (builder pre-resolves and emits a richer op). See "Key implementation notes" below.
- [ ] Demo case in `src/app/main.ts` — `Organization.query().whereHas("users", q => q.where("status", "active")).parse()` — verify SQL
- [ ] Type-check, format

## Key implementation notes

### Where to resolve the relation definition

The parser currently has no reference to `relationDefinitions` or `modelClass`. Two options:

**(a) Pass relationDefinitions into parser constructor.** Lowest disruption — add an optional `relationDefinitions?: Record<string, RelationDefinition>` to `PostgresParserOptions`. The parser resolves at process-time. Symmetric with `applyJoinRelations` (which lives on the builder, not the parser).

**(b) Builder pre-resolves and emits a richer op.** `whereHas("posts", cb)` becomes `addOperation("whereHas", { table: "posts", localKey: "id", foreignKey: "user_id", subquery: cb-ops })`. Parser stays definition-blind.

**Recommend (b).** Matches the existing `selectRelatedColumns` pattern — the builder is the source of truth for relation resolution. Keeps the parser pure (translates ops → SQL, no schema awareness). Centralises the FK-default resolution (relevant once [`fk-default-centralisation`](./2026-05-12-fk-default-centralisation.md) lands — both `selectRelatedColumns` and `whereHas` then share the resolver).

### Subquery shape per relation type

```sql
-- hasMany / hasOne
EXISTS (SELECT 1 FROM "posts"
  WHERE "posts"."user_id" = "users"."id" [AND <constraint>])

-- belongsTo (degenerate but consistent)
EXISTS (SELECT 1 FROM "users"
  WHERE "users"."id" = "posts"."user_id" [AND <constraint>])

-- belongsToMany (constraint-free)
EXISTS (SELECT 1 FROM "post_tags"
  WHERE "post_tags"."post_id" = "posts"."id")

-- belongsToMany (with constraint on related)
EXISTS (SELECT 1 FROM "post_tags"
  INNER JOIN "tags" ON "tags"."id" = "post_tags"."tag_id"
  WHERE "post_tags"."post_id" = "posts"."id"
  AND <constraint on tags>)
```

`has(relation, op, count)` uses COUNT-comparison instead of EXISTS:

```sql
(SELECT COUNT(*) FROM "posts" WHERE "posts"."user_id" = "users"."id") >= 5
```

### Reuse `absorbSubParserParams`

Already shipped in [`a332816`](#). Sub-parser produces WHERE-fragment with its own `$N` numbering; absorb into outer's `params`, rewrite `$N → $M`. Same approach as `processSelectRelatedColumns`.

### `boolean` (AND/OR) handling

`whereHas` and `orWhereHas` are sibling methods. The op is registered with a `boolean: "AND" | "OR"` (mirror `processWhere`'s pattern). Implementation: same `processWhereHas` switching on the boolean param.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Resolve relation def in parser or builder? | **Builder.** Matches `selectRelatedColumns`, keeps parser pure. |
| 2 | `EXISTS` vs `IN (SELECT id FROM ...)`? | **EXISTS.** Better planner short-circuit, avoids materialising id list. |
| 3 | `has(rel, ">=", 1)` — alias for `has(rel)`? | **Yes.** `has(rel)` is semantically `has(rel, ">=", 1)` — emit EXISTS for the no-op case. |
| 4 | Constraint with `orderBy`/`limit` — drop or error? | **Silently drop with dev-warn.** Matches withCount precedent. |
| 5 | belongsToMany constraint targets pivot or related? | **Related.** Matches withCount precedent. |

## Verification

- [ ] Demo cases in `src/app/main.ts` (extend `runWithCountDemo` or add new function):
  - `User.query().whereHas("posts").parse()` → bare EXISTS
  - `User.query().whereHas("posts", q => q.where("isPublished", true)).parse()` → EXISTS with constraint
  - `User.query().has("posts", ">", 5).parse()` → COUNT comparison
  - `User.query().doesntHave("posts").parse()` → NOT EXISTS
  - `Post.query().whereHas("tags", q => q.where("isActive", true)).parse()` → belongsToMany w/ pivot JOIN
- [ ] tsc clean
- [ ] Manual SQL check against expected shapes above

## Summary

`whereHas` / `has` / `orWhereHas` / `doesntHave` / `whereDoesntHave` were exposed on the contract and stored as ops by the base query-builder, but the Postgres parser had zero implementations — every call was a silent no-op at execution. Now wired end-to-end.

**Approach refined from the plan.** The plan recommended option (b) "builder pre-resolves and emits a richer op". The actual implementation went one step further: the builder TRANSLATES the has-family ops into existing `whereRaw` / `orWhereRaw` ops at execute time, so the parser doesn't need any new cases at all. Same pattern as `applyJoinRelations` and `applyCountRelations`. Net effect: parser stays pure (no schema awareness), translation logic lives next to its siblings, and the existing parser type-union entries for `has`/`whereHas`/etc become harmless dead code.

**Implementation locations:**
- `applyHasRelations()` private method on `PostgresQueryBuilder` — scans operations for has-family ops and rewrites them in-place via `Array.map`, preserving position so AND/OR booleans stay correctly slotted.
- `translateHasOp(op)` — resolves the relation definition, resolves the related model class, dispatches to `buildHasSubquery`.
- `buildHasSubquery(opType, ...)` — branches on relation type (hasMany/hasOne/belongsTo/belongsToMany), builds the FROM + JOIN-condition + WHERE fragments, wraps with EXISTS / NOT EXISTS / COUNT-comparison.
- Idempotency flag `hasRelationsApplied` so `parse()` then `get()` doesn't double-translate.
- Hooked into both `get()` and `parse()` between `applyJoinRelations` and `applyCountRelations`.
- `orWhereHas` overload added to the contract (was missing — base implementation existed but no contract surface).

**SQL shapes verified by demo (`runWhereHasDemo` in `src/app/main.ts`):**

```sql
-- Organization.has("users")
... WHERE EXISTS (SELECT 1 FROM "users" WHERE "users"."organization_id" = "organizations"."id")

-- Organization.whereHas("users", q => q.where("status", "active"))
... WHERE EXISTS (SELECT 1 FROM "users" WHERE "users"."organization_id" = "organizations"."id" AND "users"."status" = $1)

-- Organization.has("users", ">", 5)
... WHERE (SELECT COUNT(*) FROM "users" WHERE "users"."organization_id" = "organizations"."id") > 5

-- Organization.doesntHave("users")
... WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."organization_id" = "organizations"."id")

-- Outer where + whereHas — boolean position preserved
... WHERE "organizations"."status" = $1 AND EXISTS (...)

-- orWhereHas
... WHERE "organizations"."status" = $1 OR EXISTS (...)
```

**Conscious code duplication.** `buildHasSubquery` duplicates the four-relation-type branching of `buildCountSubquery` (FROM + JOIN-condition construction). Not extracted to a shared helper in this PR to keep the withCount work fresh and testable. Once polymorphic + through relations land, the four-way duplication makes consolidation worth doing — tracked as a follow-up under the planned Postgres relations-pipeline extraction.

**Not addressed (separate plans / out of scope):**
- `joinWith` belongsTo/hasOne constraint where-clause drop — separate plan.
- Mongo whereHas execution — same gap as Mongo withCount; separate follow-up.
- `has` with constraint callback — not in the contract today; defer.
