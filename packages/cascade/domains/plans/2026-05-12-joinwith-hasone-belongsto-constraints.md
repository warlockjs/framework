# 2026-05-12 — joinWith — honour where-clauses on hasOne/belongsTo constraints

**Status:** completed
**Severity:** S3 (Medium)
**Estimated effort:** 0.5 day
**Completed:** 2026-05-12
**Context:** Audit findings 2026-05-12. Spotted while implementing `withCount`. Currently a silent feature gap.

## Why

[`processSelectRelatedColumns`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.ts:746) at lines 819-845 (the hasOne/belongsTo branch) creates a sub-parser from the constraint ops but only reads `selectColumns` from it:

```ts
if (constraintOps && constraintOps.length > 0) {
  const subParser = new PostgresQueryParser({ ... });
  subParser.parse();
  if (subParser.selectColumns.length > 0) {
    effectiveSelect = subParser.selectColumns;
  }
}
```

Where-clauses produced by the constraint are **silently dropped**. `joinWith({ author: q => q.where("isActive", true) })` returns the same SQL as `joinWith("author")`.

Inconsistent with the hasMany branch (which DOES honour constraint where-clauses since 2026-05-11) and inconsistent with what users reasonably expect from a constraint callback.

## Scope

**In:** Postgres parser hasOne/belongsTo branch — apply constraint where-clauses to the LEFT JOIN's ON condition.

**Out:** orderBy / limit on a hasOne/belongsTo joinWith (semantically nonsense — single related row, no ordering possible). Drop with dev-warn.

## Tasks

- [ ] In `processSelectRelatedColumns` hasOne/belongsTo branch:
  - When `constraintOps` are present, build a sub-parser as today
  - **Additionally** read `subParser.whereClauses` and bind them to the LEFT JOIN's ON clause via `absorbSubParserParams` ([`a332816`](#))
- [ ] Locate where the LEFT JOIN is emitted for hasOne/belongsTo — currently in [`postgres-query-builder.ts:996-1003`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts:996) (`addOperation("leftJoin", ...)`). The constraint where needs to be passed through to the JOIN op, not the SELECT op
- [ ] Plumb constraintOps through to the leftJoin op:
  - `applyJoinRelations` already passes `constraintOps` via `selectRelatedColumns` for hasMany
  - Add the same threading for the hasOne/belongsTo path so the parser can attach extra ON conditions
- [ ] Update `processJoin` (or a new `processLeftJoinWithConstraints`) to absorb sub-parser params and append `AND <constraint-where>` to the ON clause
- [ ] Drop orderBy/limit silently with `console.warn` in dev — same precedent as `withCount` constraint handling
- [ ] Demo case + verify SQL
- [ ] tsc clean

## Key implementation notes

### Why ON-clause, not WHERE

Adding the constraint to the outer WHERE would:

- Filter out main-table rows that lack a matching constraint-passing related row (turns LEFT JOIN behaviour into INNER JOIN behaviour)
- Break the "always return main rows, related is just optional" expectation

Putting the constraint in the JOIN's ON clause keeps the LEFT JOIN semantics — main rows are always returned; related is `null` when the constraint fails:

```sql
LEFT JOIN "users" AS "author"
  ON "author"."id" = "posts"."author_id"
  AND "author"."is_active" = $1
```

### Alternative: subquery target

```sql
LEFT JOIN (SELECT * FROM "users" WHERE "is_active" = $1) AS "author"
  ON "author"."id" = "posts"."author_id"
```

More flexible (supports orderBy/limit on the constraint sub-query), but adds SQL noise + the planner usually flattens the subquery into the same plan anyway. Defer.

### Param plumbing

Reuse `absorbSubParserParams` exactly as it's used in the hasMany branch.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | ON-clause append vs subquery wrap? | **ON-clause append.** Less SQL, planner-friendly, simpler. |
| 2 | Constraint orderBy/limit — drop or error? | **Drop with dev-warn.** Same precedent as withCount. |
| 3 | Threading constraintOps through leftJoin op or stuffing in selectRelatedColumns? | **Through leftJoin.** The constraint is JOIN-level, not SELECT-level; route it where it ends up. |

## Verification

- [ ] Demo case: `Post.joinWith({ author: q => q.where("isActive", true) }).parse()` → LEFT JOIN with extended ON
- [ ] Posts WITHOUT a matching active author still appear (LEFT JOIN semantics preserved)
- [ ] tsc clean

## Summary

Constraint where-clauses on `joinWith` hasOne/belongsTo are now honoured by appending them to the LEFT JOIN's ON clause — preserves LEFT JOIN semantics (main rows stay even when no related row passes the constraint).

**Implementation:**
- `applyJoinRelations` now threads `config.constraintOps` through the `leftJoin` op's data (previously only passed via `selectRelatedColumns`).
- `processJoin` reads `constraintOps`, filters for where-ops only, runs a sub-parser, absorbs its params via `absorbSubParserParams`, and appends the renumbered where-fragment to the ON clause as `AND <fragment>`.
- orderBy/limit on the constraint are silently dropped — no meaning on a single-row LEFT JOIN.

**Resulting SQL:**

```sql
-- Post.joinWith({ author: q => q.where("isActive", true) })
LEFT JOIN "users" AS "author"
  ON "post"."author_id" = "author"."id"
  AND "author"."isActive" = $1
```

Reuses `absorbSubParserParams` from `a332816` so the sub-parser's `$N` placeholders rebase correctly into the outer parser's numbering.
