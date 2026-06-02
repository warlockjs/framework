# 2026-05-12 — Centralise relation foreign-key defaults

**Status:** in-progress (wiring complete, awaiting commit + optional Phase D verification pass)
**Severity:** S2 (High)
**Estimated effort:** 0.5 day
**Started:** 2026-05-12
**Context:** Audit findings 2026-05-12. Footgun surfaced while writing `applyCountRelations` — three code paths default the FK differently for the same relation.

## Why

The default-FK convention differs between the three relation-resolution code paths:

| Code path | belongsTo default FK | Where defined |
|-----------|---------------------|---------------|
| `with()` (RelationLoader) | `${name}_id` (snake_case) | [`relation-loader.ts:283`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:283) |
| `joinWith()` (`applyJoinRelations`) | `${relationName}Id` (camelCase) | [`postgres-query-builder.ts:988`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts:988) |
| `withCount()` (`applyCountRelations`) | `${relationName}Id` (camelCase) | [`postgres-query-builder.ts`](../../../@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts) (added 2026-05-11) |

For `hasMany`/`hasOne`/`belongsToMany`, similar drift exists — `inferForeignKey(modelName)` in RelationLoader returns camelCase `userId`, while the codebase actually uses snake_case columns (`organization_id`, `image_id`, `chat_id`).

**Symptom.** A model that omits `foreignKey` in its relation def will have:

- `User.query().with("posts").get()` work (snake-case match) — but only by accident
- `User.query().joinWith("posts").get()` fail (looks for `userId` instead of `user_id`)
- `User.query().withCount("posts").get()` fail (same)

Every relation in the codebase today passes `foreignKey` explicitly to dodge this. That's masking the bug, not fixing it.

## Scope

**In:** Single shared FK-resolution module used by all three code paths; convert defaults to snake_case to match the codebase's actual column convention.

**Out:** Changing existing explicit-`foreignKey` callsites (they continue to work). MongoDB driver's own conventions (separate audit).

## Tasks

- [ ] Create `@warlock.js/cascade/src/relations/key-conventions.ts`. Public exports:
  - `inferBelongsToForeignKey(relationName: string): string` → `${snake(relationName)}_id`
  - `inferHasForeignKey(selfModelName: string): string` → `${snake(selfModelName)}_id`
  - `inferPivotKey(modelName: string): string` → `${snake(modelName)}_id`
  - Private `snake(input: string)` wrapper around `toSnakeCase` from `@mongez/reinforcements` — the lib loses runs of consecutive uppercase ("AIModel" → "imodel"); pre-normalise via two regex splits so acronym-prefixed models work. NOT exported; implementation detail.
  - **Followup:** upstream the cap-run fix to `@mongez/reinforcements`. Once a release ships, drop the wrapper and import `toSnakeCase` directly at the three callsites.
- [ ] Audit ALL FK-default sites:
  - `relation-loader.ts:192` (`loadHasMany`)
  - `relation-loader.ts:235` (`loadHasOne`)
  - `relation-loader.ts:283` (`loadBelongsTo`)
  - `relation-loader.ts:338-339` (`loadBelongsToMany` pivot keys)
  - `relation-loader.ts:545-547` (`inferForeignKey`)
  - `postgres-query-builder.ts:986-993` (`applyJoinRelations`)
  - `postgres-query-builder.ts:applyCountRelations` (whole branch)
  - Mongo equivalents if any
- [ ] Replace every site with the central helper
- [ ] Drop `inferForeignKey` from `RelationLoader` (private method) — re-export from `key-conventions.ts`
- [ ] Update `helpers.ts` JSDoc on each factory to document the convention explicitly
- [ ] Run grep for any model in `src/app/**` that defines a relation WITHOUT an explicit `foreignKey` and verify it would still resolve correctly — these are the at-risk callsites
- [ ] Type-check, format

## Key implementation notes

### snake_case vs camelCase

The codebase uses snake_case for DB column names (`organization_id`, `chat_id`, `image_id`, `user_id`). PG-native idiom too. Lock the default at snake_case.

**Implication.** Anyone who today relies on the camelCase `joinWith`/`withCount` defaults will see their query break after this lands. Mitigation: those callsites would be **already broken** because the column doesn't exist — they'd just be getting a SQL error, not silent wrong results. Audit + grep before rollout.

### `snake()` helper edge cases

The `toSnakeCase` from `@mongez/reinforcements` doesn't split runs of consecutive caps — the regex captures only the last letter in each run. Verified behaviour:

```
toSnakeCase("AIModel")         → "imodel"        ❌
toSnakeCase("HTTPSConnection") → "sconnection"   ❌
```

Real impact: `AIModel`, `AIUsage`, `AITrip`, `AIAgent` all exist in `src/app/**`. Without preprocess, every defaulted FK against these would resolve to a column that doesn't exist.

Wrapper preprocess (private to the module):

```ts
function snake(input: string): string {
  const normalised = input
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")  // "AIModel" → "AI_Model"
    .replace(/([a-z\d])([A-Z])/g, "$1_$2");     // "BlogPost" → "Blog_Post"
  return toSnakeCase(normalised).toLowerCase();
}
```

Verified against:
```
snake("User")            → "user"
snake("BlogPost")        → "blog_post"
snake("AIModel")         → "ai_model"
snake("HTTPSConnection") → "https_connection"
snake("AIUsage")         → "ai_usage"
snake("organization")    → "organization"  (idempotent)
snake("organizationId")  → "organization_id"
```

### Backward-compatibility

The runtime change is the default value. Anything passing `foreignKey: "..."` explicitly is unaffected. Anything relying on the defaults today is *already* operating on shaky ground because the three paths disagree — moving everyone to one consistent default fixes more than it breaks.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | snake_case or camelCase default? | **snake_case.** Matches DB column convention used in this codebase and PG idiom. |
| 2 | Keep `RelationLoader.inferForeignKey` as a private method or move? | **Move to `key-conventions.ts`** as a named export. Private duplication invites drift. |
| 3 | Should the central helper read a config option (so app can flip to camelCase)? | **No, v1.** Add config later if a real consumer needs it. YAGNI now. |
| 4 | Audit-then-fix or ship-then-fix? | **Audit first.** A grep across `src/app/**` for `belongsTo\|hasMany\|hasOne\|belongsToMany` callsites without `foreignKey` is fast and catches real regressions. |

## Verification

- [ ] Grep audit: zero models in `src/app/**` rely on a now-changed default in a way that breaks SQL execution
- [ ] All three paths (with/joinWith/withCount) produce IDENTICAL SQL FK references for the same relation when defaults are used
- [ ] Existing demo (`runWithCountDemo`) still produces the same SQL
- [ ] tsc clean

## Summary

_To be filled on completion._
