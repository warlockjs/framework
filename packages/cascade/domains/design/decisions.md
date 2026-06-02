# @warlock.js/cascade — Locked Design Decisions

**Status:** Agreed (append-only, newest first)

Decisions taken with reasoning. Use this when a future session wants to "reconsider" something — the reasoning here usually still applies.

---

## 10. Cascade owns DB Operations API + standalone CLI; warlock-core's commands become pass-throughs

**Date.** 2026-05-23

**Decision.** Migration and database orchestration moves from `@warlock.js/core/src/database/*-action.ts` into a named **Operations API** in `@warlock.js/cascade/src/operations/` — exported functions (`runMigrations`, `rollbackMigrations`, `freshMigrate`, `exportMigrationsSQL`, `listExecutedMigrations`, `createDatabase`, `dropAllTables`) wrapping the existing `migrationRunner` singleton plus `dataSourceRegistry` driver lookups. Cascade ships its own `cascade` binary (citty-based, ESM) that consumes the Operations API for migration commands only — `cascade migrate` / `migrate:list` / `migrate:rollback` / `migrate:export-sql`. Warlock-core's existing CLI commands stay where they are; their action bodies shrink to thin pass-throughs calling the same Operations API.

**Why.**

- The wiring was already upside-down — core's actions reached into Cascade's primitives (`migrationRunner.runAll()`, `dataSource.driver.dropAllTables()`) from a sibling package. The Operations API makes that relationship *intentional* and gives Cascade a stable public seam consumers can rely on while the runner internals evolve.
- One source of truth, two surfaces. Warlock projects keep their `warlock migrate` ergonomics; standalone Cascade users get a `cascade` binary they can invoke against any TS project. Both call into identical code paths — bug-for-bug consistency, verified end-to-end against the live `ai` PostgreSQL DB (36 migrations).
- Extracting a separate `@warlock.js/cli` package (the alternative considered) is over-investment for one consumer. The CLI surface stays where its consumers live: core's hand-rolled CLI in core (preload/persistent/auto-discovery semantics citty doesn't model), cascade's small citty CLI in cascade. Two patterns are acceptable because cascade can't depend on core's runtime anyway (would invert the dep).
- Standalone CLI configures itself entirely from env vars — no `cascade.config.{ts,js}` to discover/parse/document. Connection knobs follow 12-factor (`DATABASE_URL` plus discrete `DB_*` with warlock-shaped aliases); migration knobs that affect generated SQL (`CASCADE_PRIMARY_KEY`, `CASCADE_UUID_STRATEGY`) are env-vars too. Re-affirmed after env-only fully resolved the FK-type-mismatch case surfaced during live testing.

**Trade-off.**

- Two CLI patterns in the monorepo (hand-rolled in core, citty in cascade). Justified — different scopes, different consumers; cascade's CLI is small enough that a battle-tested lib costs less than re-implementing.
- The `cascade` binary loads migration files via plain `await import()` — no TS transpiler bundled. TS users invoke through their own runtime (`tsx node_modules/.bin/cascade migrate`). Accepted; cascade stays opinion-free about TS runtime.
- `MigrationDefaults` env-var coverage is `primaryKey` + `uuidStrategy` for v1. `uuidExpression` (raw SQL override) is not env-exposed — add `CASCADE_UUID_EXPRESSION` when a user asks. Other DataSource knobs (`modelDefaults`, `relationDefaults`, etc.) aren't surfaced because they don't affect migration SQL generation.
- The summary line `freshMigrate` returns concatenated rollback + run results — printer reports a single combined count (e.g., "68/68") rather than separating phases. Cosmetic follow-up; logic is correct.

**Where documented.** Spec: [`operations-api.md`](./operations-api.md). Skill: [`../skills/cascade-cli/SKILL.md`](../skills/cascade-cli/SKILL.md). User guide: [`../docs/guides/cli.md`](../docs/guides/cli.md). API reference: [`../docs/reference/operations-api.md`](../docs/reference/operations-api.md). Source: `@warlock.js/cascade/src/operations/{migrations,database}.ts`, `@warlock.js/cascade/src/cli*`, `@warlock.js/cascade/bin/cascade.mjs`. Plan: `plans/2026-05-22-operations-api-and-cli.md`.

---

## 9. Postgres `groupBy(fields, aggregates)` — builder-side decompose, dialect-owned aggregate→SQL, parse-time HAVING rewrite

**Date.** 2026-05-16

**Decision.** Postgres two-arg `groupBy` is implemented entirely builder-side: the QB override projects grouped columns + `selectRaw("<sql> AS alias")` and records `alias→sql`; `aggregateToSql` lives on `SqlDialectContract` (Postgres impl); a parse-time `applyGroupByAggregates` pass rewrites `having()` on an aggregate alias into a substituted `havingRaw`. The parser gains **no** `groupByWithAggregates` op — the only parser change is a 3-line `processHavingRaw` bindings-threading fix. The five clean aggregates (`count`/`sum`/`avg`/`min`/`max`) map to SQL; `distinct`/`floor`/`first`/`last` throw a fail-fast MongoDB-only error at `.groupBy()` time.

**Why.**

- Mirrors decision #8 exactly: relation/aggregate knowledge stays in the builder, parser stays pure (no schema awareness). `applyGroupByAggregates` slots in beside `applyHasRelations`/`applyCountRelations` with the same in-place `Array.map` rewrite shape.
- Postgres forbids SELECT aliases in `HAVING` (only `GROUP BY`/`ORDER BY`). Without the rewrite, `.having("total", ">", n)` on a computed aggregate throws `column "total" does not exist` at runtime while the same chain works on MongoDB — the exact silent-divergence footgun the task existed to kill.
- `aggregateToSql` on the dialect (not a private QB method) keeps the override thin and forces MySQL to declare its own aggregate capability matrix at the seam, next to `supportsReturning`/`upsertKeyword`.
- The four MongoDB-only helpers have no honest single-scalar SQL `GROUP BY` equivalent; emitting `COUNT(DISTINCT f)` / `FLOOR` / `FIRST_VALUE` would be silently-different semantics. Fail-fast + name the `selectRaw`/`havingRaw` escape hatch.
- `processHavingRaw` already silently dropped its bindings (unlike `processWhereRaw`/`processSelectRaw`); the rewrite needs parameterized output (literal-inlining = SQL injection), so the consistency fix is required and also fixes that pre-existing latent bug.

**Trade-off.**

- "Zero parser changes" became "one 3-line consistency fix" — accepted; categorically not Option A's `OperationType`/switch surgery, and it removes a latent bug.
- Cascade's unit lane is mock-driver only, so real-Postgres acceptance was proven out-of-band via `src/app/examples/groupby-aggregates-demo.ts` + `yarn start` rather than an in-suite DB test. A dedicated DB-backed lane is a deferred optional follow-up.
- `first`/`last`/`distinct`/`floor` parity deferred (window-function ordering API + array-shape semantics are a separate, larger design). Documented MongoDB-only for v1.

**Where documented.** Spec: [`groupby-aggregates.md`](./groupby-aggregates.md). Skill: [`../skills/groupby-aggregates/SKILL.md`](../skills/groupby-aggregates/SKILL.md). Source: `drivers/postgres/postgres-query-builder.ts` (`groupBy`, `applyGroupByAggregates`), `postgres-dialect.ts` (`aggregateToSql`), `postgres-query-parser.ts` (`processHavingRaw`). Plan: `plans/2026-05-16-postgres-groupby-aggregates-parity.md`.

---

## 8. `whereHas` family is translated builder-side into `whereRaw`, not parser-side

**Date.** 2026-05-12

**Decision.** `has` / `whereHas` / `orWhereHas` / `doesntHave` / `whereDoesntHave` are recorded as their named ops by the base query-builder, then **translated** into existing `whereRaw` / `orWhereRaw` ops by `PostgresQueryBuilder.applyHasRelations()` before the parser runs. The parser never gains case-arms for the has-family op types — they're rewritten out of the operations list before parsing.

**Why.**

- Mirrors the established pattern: `applyJoinRelations` translates `joinWith` ops into `selectRelatedColumns` + `leftJoin` ops; `applyCountRelations` translates `countRelations` Map into `selectRaw` ops. `applyHasRelations` slots in cleanly with the same shape.
- Keeps the parser pure (no schema / relation awareness). All relation knowledge lives in the builder, which already needs it for `joinWith` / `withCount`.
- In-place rewrite via `Array.map` preserves position so AND/OR booleans stay correctly slotted relative to surrounding `where` ops — `orWhereHas` correctly produces an `OR EXISTS(...)` clause, not an `AND OR EXISTS(...)`.
- `EXISTS` over `IN (SELECT id FROM ...)` for short-circuit planner behaviour. `has(rel, op, count)` uses a COUNT comparison `(SELECT COUNT(*) ...) op n` because EXISTS can't express it.
- belongsToMany without constraint: pivot-only EXISTS. With constraint: pivot INNER JOIN related so the constraint can target related columns. Same rule as withCount.

**Trade-off.**

- Original parser type-union entries for `has`/`whereHas`/etc become harmless dead code — never emitted, never matched. Could remove but the cost is zero. Leave as-is.
- `buildHasSubquery` duplicates the 4-relation-type branching of `buildCountSubquery`. Conscious duplication for now; once polymorphic + through land, the 4-way duplication earns a shared `buildRelationSubqueryParts` helper.

**Where documented.** `drivers/postgres/postgres-query-builder.ts` → `applyHasRelations`, `translateHasOp`, `buildHasSubquery`. Plan: `domains/cascade/plans/2026-05-12-wherehas-family.md`.

---

## 7. Code-organisation discipline — file & method size ceilings

**Date.** 2026-05-12

**Decision.** Resist accumulation of god-files. Apply the following ceilings to every cascade source file:

- **Hard ceiling: 1500 lines per file.** When approaching, split. No file gets to 2000.
- **Soft ceiling: 1000 lines.** Triggers a "should this split?" review. Often the answer is yes.
- **Method-count ceiling: 25-30 per class.** Beyond that, multiple responsibilities are hiding behind one class name.
- **Always extract genuinely independent helpers** even when small (per `code-style.md` §4.1).

**Why.**

- Cascade today (parser 1158, builder 1427) sits upper-middle compared to ORM peers — Drizzle / MikroORM keep files in the 300-800 range; TypeORM / Eloquent / Sequelize have 3000+ line god-files that are notorious in their communities. The discipline cost is much smaller than the recovery cost.
- Pre-1.0 reorganisation has zero blast radius on consumers.
- Doc-comments inflate cascade's LOC count by ~30-40%, so actual code is comfortably under the ceilings — but the read-time cost still applies (comments matter for reviewing too).
- The "every feature lands in the existing class" path is how legacy ORMs ended up where they did. Path A (size accumulation) is the default if you don't actively fight it.

**Trade-off.**

- Splitting state-coupled logic (e.g. parser methods that share `paramIndex` / `params`) introduces ceremony — pass parent-parser, expose state-mutators, etc. Mitigation: split by cohesion (relation methods cluster, non-relation core stays unified), not by size alone.
- Some splits will need to be undone or reorganised as features land. Acceptable cost — better than accumulating debt.

**First applications planned.**

- Extract `processSelectRelatedColumns` (148-line method, biggest in the parser) to its own file.
- After whereHas lands, extract Postgres builder relations-pipeline (joinWith + applyJoinRelations + applyCountRelations + helpers) into `postgres-relations-pipeline.ts`.

**Where documented.** This decision; informs PR reviews and future sub-plans.

---

## 6. Foreign-key default inference is centralised (snake_case + Model.primaryKey)

**Date.** 2026-05-12

**Decision.** All four relation-resolution code paths (`with` via RelationLoader, `joinWith` via `applyJoinRelations`, `withCount` via `buildCountSubquery`, pivot operations via `getPivotConfig`) read default FK column names from a single helper module: `relations/key-conventions.ts`. The helper exports three functions: `inferBelongsToForeignKey(relationName)`, `inferHasForeignKey(selfModelName)`, `inferPivotKey(modelName)` — all returning `${snake(input)}_id`. Local-key / owner-key / pivot-PK defaults read `Model.primaryKey` instead of hardcoded `"id"`.

**Why.**

- Before this, three private `inferForeignKey` methods (RelationLoader, PivotOperations, PostgresQueryBuilder) each implemented camelCase `${name}Id`, while RelationLoader's `loadBelongsTo` separately defaulted to snake `${name}_id`. Same relation could resolve to different FKs across paths — silent wrong-column at runtime.
- snake_case + `_id` matches PostgreSQL idiom and the existing column convention used throughout `src/app/**` (`organization_id`, `chat_id`, `image_id`, …).
- Naming basis differs by relation type — `belongsTo` uses the **relation name** (so `Post.author_id` not `Post.user_id`), while `hasMany`/`hasOne`/`belongsToMany` use the relevant **model class name**. Mature ORMs all do this.
- Reading `Model.primaryKey` instead of hardcoded `"id"` fixes a latent bug for any model that overrides its primary-key column name.

**Trade-off.**

- Breaking change to the camelCase defaults previously emitted by `joinWith` / `withCount`. Audit of `src/app/**` confirmed every relation passes `foreignKey` explicitly, so blast radius was zero in this codebase.
- The `@mongez/reinforcements` `toSnakeCase` lib loses leading letters in runs of consecutive uppercase (`AIModel` → `imodel`). Wrapped in a private `snake` helper that pre-normalises cap-runs. Once an upstream fix lands, the wrapper can be deleted.

**Where documented.** `relations/key-conventions.ts` (helper); `relations/relation-loader.ts`, `relations/pivot-operations.ts`, `drivers/postgres/postgres-query-builder.ts` (consumers).

---

## 1. `withCount()` emits a correlated subquery, not LEFT JOIN + GROUP BY

**Date.** 2026-05-11

**Decision.** `withCount("relation")` (and its constraint / alias variants) is translated by the Postgres driver into one correlated `(SELECT COUNT(*) FROM <related> WHERE <fk> = <self>.<pk> [...constraint])::int AS "<alias>"` expression per entry, appended to the outer SELECT list. No LEFT JOIN, no GROUP BY rewrite of the outer query.

**Why.**

- Mirrors the existing `hasMany` decision in `processSelectRelatedColumns` (postgres-query-parser.ts:759-818): JSON-aggregate subquery instead of LEFT JOIN, to avoid row explosion.
- A LEFT JOIN + `GROUP BY` would force every other selected column into the GROUP BY list (or aggregation), which interacts badly with `select(...)` overrides, scopes that touch `where`, and downstream `joinWith` JOINs.
- Postgres's planner rewrites correlated counts into hash-aggregates when the cost is right — we don't lose much performance, and we keep the outer query shape independent of how many counts are requested.
- Each count is independently constrainable (different `WHERE` per alias) without requiring N separate `GROUP BY` queries.

**Trade-off.**

- N count subqueries × M result rows. For paginated lists fine; for full-table scans without `.limit()` it scales linearly. Document in the relations how-to once that page exists.
- `bigint → string` returned by node-postgres is sidestepped via the `::int` cast — overflows above 2.1B counts but no realistic relation hits that.

**Where documented.** `drivers/postgres/postgres-query-builder.ts` → `applyCountRelations` / `buildCountSubquery`.

---

## 2. `countRelations` storage is `Map<alias, {relation, constraintOps?}>`

**Date.** 2026-05-11

**Decision.** The query builder stores `withCount` entries in a `Map` keyed by the **output column alias**, with the underlying relation name and any captured constraint ops as the value. This replaced the previous `string[]` typing.

**Why.**

- Aliasing by output column lets the same relation appear multiple times under different filters: `withCount({ users: true, "users as activeUsers": q => q.where("status", "active") })` produces two columns from the same `users` relation.
- Keeping the relation name separate from the alias avoids parsing the alias shorthand (`"rel as alias"`) more than once.
- Map iteration is order-preserving — count subqueries are emitted in the order the user registered them.

**Trade-off.** Breaking change to the contract field type (`countRelations?: string[]` → `countRelations?: Map<string, {...}>`). No external consumers found via grep, so no shim added.

**Where documented.** `contracts/query-builder.contract.ts` → `countRelations` field; `query-builder/query-builder.ts` → `withCount` + `parseCountSpec`.

---

## 3. `belongsToMany` count is pivot-only when unconstrained, pivot+JOIN when constrained

**Date.** 2026-05-11

**Decision.** For `belongsToMany` relations, an unconstrained `withCount("tags")` emits `SELECT COUNT(*) FROM <pivot> WHERE <pivot>.<localKey> = <self>.<pivotLocalKey>`. When a constraint callback references the related model, the subquery `INNER JOIN`s the related table inside the count.

**Why.**

- The pivot table alone holds enough information to count associations — joining to the related table is wasted work when there's no filter against it.
- Constraint callbacks target the **related model** (e.g. `q.where("isPublished", true)` against tags), so the related table must be in scope for those filters to resolve.

**Trade-off.** Constraint callbacks against pivot-table columns specifically aren't supported in this v1 — the callback always runs against the related model. If pivot-column filtering is needed (e.g. count tags where the pivot's `created_at > X`), that needs a dedicated API.

**Where documented.** `drivers/postgres/postgres-query-builder.ts` → `buildCountSubquery` belongsToMany branch.

---

## 4. `parse()` runs the same prelude as `get()` and `apply*` methods are idempotent

**Date.** 2026-05-11

**Decision.** `PostgresQueryBuilder.parse()` invokes `applyPendingScopes` → `_processJoinWithOps` → `applyJoinRelations` → `applyCountRelations` before serialising the query, so the SQL preview matches what `get()` would actually execute. To make `parse()` then `get()` (or repeated `parse()`) safe, `applyJoinRelations` and `applyCountRelations` carry idempotency flags (`joinRelationsApplied`, `countRelationsApplied`) — same pattern `applyPendingScopes` uses with `scopesApplied`.

**Why.**

- Before this fix, `.withCount("posts").parse()` returned the bare `SELECT * FROM <table>` with no count subquery, because the prelude steps were only run inside `get()`. Inspection diverged from execution — confusing and a poor debugging experience.
- Idempotency flags were chosen over cloning-the-builder because the existing `applyPendingScopes` already mutates `this` (sets `scopesApplied = true`); flags keep the existing pattern uniform.

**Trade-off.** Flags must be carried through `clone()` so a cloned builder doesn't immediately re-emit ops. Done in `PostgresQueryBuilder.clone`.

**Where documented.** `drivers/postgres/postgres-query-builder.ts` → `parse()`, `applyJoinRelations`, `applyCountRelations`, `clone()`.

---

## 5. Mongo `withCount` override removed; execution remains unimplemented

**Date.** 2026-05-11

**Decision.** The MongoDB query builder previously declared its own `countRelations: string[]` field and a no-op `withCount(...relations: string[])` method that pushed onto it. Both removed. Mongo now inherits the Map-typed base implementation but the aggregation pipeline has no consumer for the Map — `withCount` is honest about being unimplemented for Mongo until a follow-up wires `$lookup` + `$size`.

**Why.**

- Keeping the override would have required updating its types to the new Map shape just to remain a no-op — wasted ceremony around a known gap.
- Inheriting the base means the Map gets populated correctly, so a future Mongo implementation only needs to write the executor side.

**Trade-off.** Anyone calling `Model.withCount(...)` against a Mongo-backed model gets registered intent without execution — same effective behaviour as before, but now with consistent storage.

**Where documented.** `drivers/mongodb/mongodb-query-builder.ts` (removal); follow-up tracked separately.
