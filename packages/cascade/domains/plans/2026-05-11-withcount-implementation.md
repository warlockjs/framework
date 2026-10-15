# 2026-05-11 — withCount Implementation (Postgres)

**Status:** completed
**Started:** 2026-05-11
**Completed:** 2026-05-11
**Context:** `withCount()` currently a no-op at runtime — base + driver record relation names in `countRelations` but no execution path consumes them. Fixing for Postgres now; Mongo follow-up.

## Decisions (locked in chat)

- Correlated subquery, not JOIN+GROUP BY. Mirrors `hasMany` rationale at `postgres-query-builder.ts:996` (avoids row explosion).
- Full constraint support v1: `string | string[] | Record<path, true | "alias-string" | callback>`.
- Alias shorthand: `"posts as totalPosts"`.
- All four relation types (`hasOne`/`hasMany`/`belongsTo`/`belongsToMany`).
- belongsToMany: pivot-only count when no constraint; pivot JOIN related when constrained.
- Nested paths deferred (`withCount("posts.comments")` — ambiguous semantics).
- Breaking change `countRelations: string[] → Map<string, { alias, constraintOps? }>` — no shim. No external consumers (verified via grep).
- Mongo: delete the now-incompatible override; remain explicitly unimplemented. File follow-up.
- Skip tests, skills, user-facing docs.

## Verified facts before coding

- `postgres-query-parser.ts:705-722` `processSelectRaw` rewrites `?` → `$N` positionally via `addParam`. Safe to emit subquery with `?` placeholders + bindings.
- `extractJoinedRelationData` at line 1024 only deletes columns whose name matches a `joinRelations` alias. Count columns (`${rel}Count`) won't collide.
- `Model.withCount` static — does not exist; needs adding to mirror `Model.with` at `model.ts:1305-1376`.
- Prettier: package falls back to root `.prettierrc` (printWidth 100, arrowParens "always"). Memory entry `feedback_match_prettier_formatting.md` says "avoid" — that's the OTHER root `.prettierrc.json` which doesn't apply to cascade. Match the file I'm editing.
- No `domains/cascade/conventions/` exists. Only `domains/shared/conventions/code-style.md` applies. Key rules: full identifiers, brace control blocks, blank lines between stanzas, JSDoc on every method incl. private, no `any`.
- No `domains/cascade/design/` exists. Decisions log to be created after implementation.

## Tasks

- [x] `contracts/query-builder.contract.ts` — `countRelations` retyped to `Map<alias, {relation, constraintOps?}>`; overloads added (string, varargs, array, object form with `true | string | callback`)
- [x] `query-builder/query-builder.ts` — field replaced; `withCount` rewritten to normalize all input shapes; alias shorthand `"rel as alias"` parsed via `parseCountSpec`; constraint ops captured via `subQuery()`; clone updated
- [x] `drivers/postgres/postgres-query-builder.ts` — clone updated; `applyCountRelations()` called from `get()` after `applyJoinRelations`; `ensureMainColumnsForCount` guards `<table>.*`; `buildCountSubquery` branches all four relation types; `extractCountWhereFragment` uses sub-parser + `$N → ?` rebase; `inferForeignKey` mirrors `RelationLoader`
- [x] `drivers/mongodb/mongodb-query-builder.ts` — incompatible `string[]` field + no-op `withCount` override removed; inherits Map-typed base, but execution remains unimplemented (Mongo follow-up)
- [x] `model/model.ts` — `static withCount` added with all four overloads, mirroring `static with`
- [x] `tsc --noEmit` on cascade — clean (one pre-existing error in app `src/app/knowledge-base/...`, unrelated)
- [x] Created `domains/cascade/design/{README.md,decisions.md}` with five locked entries (subquery vs JOIN+GROUP BY, Map storage shape, belongsToMany pivot-vs-JOIN, parse() prelude + idempotency, Mongo override removal)

## Decision: COUNT result type

Postgres returns `COUNT(*)` as `bigint` which node-postgres surfaces as JS string. Subqueries use `::int` cast to surface as JS number for ergonomics — overflows above 2.1B but no realistic relation count hits that. Documented with `(SELECT COUNT(*) ...)::int AS "<alias>"` in `buildCountSubquery`.

## Pre-existing parser bug noticed (addressed in follow-up commit)

`processSelectRelatedColumns` in `postgres-query-parser.ts:789-805` (hasMany branch) created a sub-parser for `joinWith` constraint ops but never merged the sub-parser's `params` into the outer parser's `params`. If a `joinWith` constraint contained bindings (e.g. `q.where("active", true)`), the resulting SQL had dangling `$N` placeholders pointing to params that didn't exist in the outer query.

**Fix.** Added `absorbSubParserParams` helper on `PostgresQueryParser` that registers each sub-parser param with the outer parser via `addParam` (advancing its `paramIndex`) and returns a rewriter that translates `$N` references in embedded SQL fragments into freshly-numbered outer placeholders. Applied to both `extraWhere` and `orderBy` clause merging.

**Not addressed.** The hasOne/belongsTo branch at line 819+ silently drops constraint where-clauses entirely — that's a separate design question (belongsTo joinWith uses a LEFT JOIN; filtering would belong on the JOIN's ON clause). Logged here for separate consideration.

## Key implementation notes

**Constraint extraction.** Reuse the regex trick from `buildFilter()` (`postgres-query-builder.ts:1143`) — sub-builder → parser → pluck `WHERE …`. Fragile but matches existing convention; not a withCount-side refactor.

**Subquery binding rebasing.** Parser's `processSelectRaw` rewrites `?` → `$N` using its own `paramIndex` counter — so each subquery's WHERE-fragment must have its `$N` placeholders re-converted to `?` before being spliced into the `selectRaw` expression, so the outer parser numbers them correctly. Plan: when extracting from sub-parse, take `bindings` array as-is and rewrite `$1, $2, …` back to `?` in the WHERE-fragment string.

**belongsToMany with constraint.** Subquery emits `SELECT COUNT(*) FROM <pivot> INNER JOIN <related> ON <related>.<pivotForeignKey> = <pivot>.<foreignKey> WHERE <pivot>.<localKey> = <self>.<pivotLocalKey> AND <constraintWhere>`. Constraint runs against the related-model's columns, so the sub-builder needs to be qualified appropriately — or accept that constraints reference related-table fields by bare name and let dialect quoting do the rest.

## Open questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Should belongsTo `withCount` be allowed at all, given count ∈ {0,1}? | **Allow** — consistency over arbitrary restriction. Trivial guard against `null` is `IS NOT NULL` not `withCount`. |
| 2 | If user passes constraint to belongsToMany, qualify column refs by `<pivot>` or `<related>`? | **Related table** — constraint targets the model being counted, not the pivot. Pivot conditions stay implicit. If user needs pivot conditions, they'd need a separate API (out of scope). |
| 3 | When `constraintOps` contains things other than `where*` (e.g. `orderBy`, `limit`), silently drop them? | **Silently drop with a console.warn** in dev. ORDER/LIMIT have no meaning in COUNT subquery — warning is enough; throwing would surprise users mid-feature. |

## Summary

`withCount()` is now fully wired end-to-end on the Postgres driver. The contract was widened from `string[]` to a `Map<alias, {relation, constraintOps?}>`, with overloads accepting string / varargs / array / object forms (the object form supports `true`, alias strings, or constraint callbacks). The query builder normalises all input shapes and parses `"rel as alias"` shorthand into the Map.

At execute time, `applyCountRelations()` runs after `applyJoinRelations()` and emits one correlated `(SELECT COUNT(*) FROM <related> WHERE <fk> = <self>.<pk> [AND <constraint>])::int AS "<alias>"` `selectRaw` per entry. All four relation types (`hasMany`, `hasOne`, `belongsTo`, `belongsToMany`) are supported; belongsToMany counts the pivot table directly when unconstrained, and joins the related table inside the subquery only when a constraint is supplied. A guard (`ensureMainColumnsForCount`) preserves `<table>.*` only when no explicit select or join has already added column projections.

Two correctness fixes landed alongside the feature: `parse()` now runs the same prelude as `get()` (so previews match execution), and the apply* methods carry idempotency flags so calling `parse()` then `get()` doesn't double-emit operations. `Model.withCount` was added as a static shortcut mirroring `Model.with`.

Verified by a six-case demo in `src/app/main.ts` against the real `Organization`/`User`/`Cart`/`CartItem` schemas: bare counts, aliasing, constraint callbacks, multi-alias on the same relation with correctly-numbered `$N` bindings, composition with outer `select` + `where`, and a separate hasMany model. All six produce the expected SQL with correct param numbering.

Mongo remains unimplemented for `withCount` execution — the override was removed so the broken behaviour is now consistent and honest about the gap.

Pre-existing parser bug spotted during this work (`processSelectRelatedColumns` doesn't merge sub-parser params into outer params when joinWith constraints contain bindings) — tracked as a follow-up.
