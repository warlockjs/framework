# Cascade — Backlog

Roadmap for `@warlock.js/cascade`. Severities reflect operational impact:

- **S1 — Critical.** Silent runtime no-op or correctness bug exposed via the public API.
- **S2 — High.** Footgun that bites the moment defaults are used; cross-path inconsistency.
- **S3 — Medium.** Missing primitive that real schemas commonly need; today requires raw SQL or duplication.
- **S4 — Low.** Polish, ergonomics, performance opt-ins.

Each item links to a self-contained plan file under [`plans/`](./plans/).

---

## Release-prep audit (2026-06-01)

Findings from a skills + tests + docs accuracy pass against `src/`. Newest first.

### S1 — Critical (blocks a clean release)

- [ ] **`@RegisterModel()` decorator throws `SyntaxError: Invalid or unexpected token` under vitest.** Any test file that uses the class decorator (`tests/unit/model/model-core.test.ts`, `model-events.test.ts`, `model-registry.test.ts`, `validation/database-model-rule.test.ts`) fails to load — 4 unit suites fully red. Root cause: `tsconfig.json` is **deleted from disk** (shows `D` in git status, alongside `.gitignore` + `yarn.lock`), so vitest/esbuild lose the TC39 Stage-3 decorator config and emit decorator syntax Node's runtime can't parse. A minimal `@RegisterModel() class X extends Model {}` reproduces it. Restore `tsconfig.json` (or add the decorator transform to `vitest.config.ts`) before publish. Verified by probe; not a code-behaviour bug in cascade itself.

### S2 — High

- [ ] **Test mock drift: `getDirtyTracker` missing from mock drivers.** The `Model` constructor now calls `this.self().getDriver().getDirtyTracker(this.data)` (`src/model/model.ts:573`), but `tests/utils/test-helpers.ts` and `tests/helpers/mock-driver.ts` mocks predate that contract method. This left the remover + writer unit suites red (47 tests). **Fixed in `tests/utils/test-helpers.ts`** (added `getDirtyTracker → new DatabaseDirtyTracker(data)`); `tests/helpers/mock-driver.ts` still lacks it (plus `serialize`/`deserialize`/`atomic`/`findOneAndUpdate`/`replace`). Bring both mocks back in line with the current `DriverContract`.

- [ ] **`withCount` test-vs-source drift: `countRelations` shape changed from `string[]` → `Map<alias, { relation, constraintOps }>`.** `src/drivers/{mongodb,postgres}/*-query-builder.ts` now store counted relations in a `Map` keyed by alias, but `tests/unit/query-builder/query-builder-contract.test.ts` and the two driver builder tests still assert `.toContain("posts")` / `countRelations` as an array. ~11 tests red. Update the shared contract tests to the Map shape (source is correct; tests are stale). Plan: [`2026-05-11-withcount-implementation.md`](./plans/2026-05-11-withcount-implementation.md).

### S3 — Medium

- [ ] **Migration fixture uses removed `this.statement(...)` method.** `tests/fixtures/.../test-enhanced-features.migration.ts` (and the `Migration` JSDoc near `src/migration/migration.ts:2749`) call `this.statement(sql)`, but the queue-raw-SQL method is now `this.raw(sql)` — `statement` no longer exists on `Migration`. Update the fixture and stale docstring to `raw`.

- [ ] **Backlog + (former) docs reference `docs/guides/*.md` paths that no longer exist.** Several backlog items below link to `./docs/guides/cli.md`, `./docs/guides/delete-strategies.md`, `./docs/reference/operations-api.md`, etc. The package `domains/cascade/docs/` tree was removed when docs moved to Starlight (`@warlock.js/docs/src/content/docs/v/latest/cascade/`). Re-point these links to the Starlight pages (or drop them) in a docs-housekeeping pass.

### Notes / no-change-required (documented for accuracy)

- **Soft delete does NOT auto-hide rows.** The query builder has no built-in `deletedAt` filter; the `soft` strategy only *writes* `deletedAt`. Hiding deleted rows requires a user-registered global scope (`addGlobalScope("notDeleted", q => q.whereNull("deletedAt"))`). Skills corrected to say so. Consider shipping an opt-in auto-scope for soft-delete models (S4 ergonomics) so the common case works out of the box.
- **`transaction(fn, options)` ignores a per-source name and is not nestable.** The top-level helper resolves `getDatabaseDriver()` = the default source's driver, so `{ dataSource: "x" }` has no effect; nesting is explicitly unsupported (`database-driver.contract.ts` — "use `beginTransaction()` with savepoints"). The Postgres option key is `isolationLevel`, not `isolation`. Skills corrected. Consider honouring a `dataSource` option on `transaction()` (S4).
- **Postgres vector index is IVFFlat-only.** `postgres-migration-driver.ts` emits `USING ivfflat ... WITH (lists = N)`; `vectorIndex` options are `{ dimensions, similarity, lists, name }` — there is no `strategy`/HNSW path. Skill corrected. HNSW support would be an S4 enhancement.

### Roadmap consolidation (2026-06-01)

Deleted the legacy root wishlists `ROADMAP.md` + `CASCADE_ENHANCEMENTS.md` (Jan-2026, superseded by this structured backlog) and `usage.md` (superseded by Starlight docs). Forward-looking ideas worth keeping that aren't already tracked above: **MySQL + SQLite drivers** (both currently `throw "not yet implemented"` in `connect-to-database.ts`), **connection-pool tuning knobs**, **schema diff / auto-migration generation**, **rollback-to-specific-version**, **read-replica routing**, **multi-tenancy helpers**. File focused plans under `plans/` if/when prioritised.

---

## Relations system (audited 2026-05-12)

### S1 — Critical

- [x] [whereHas family — emit EXISTS subqueries](./plans/2026-05-12-wherehas-family.md) — Done 2026-05-12. Builder-side translation into `whereRaw`/`orWhereRaw` ops carrying EXISTS / NOT EXISTS / COUNT-comparison subqueries.

### S2 — High

- [ ] [Centralise relation foreign-key defaults](./plans/2026-05-12-fk-default-centralisation.md) — `with()` defaults to snake_case `${name}_id`, `joinWith()` and `withCount()` default to camelCase `${name}Id`. Same relation resolves to different FKs across paths.

### S3 — Medium

- [ ] [Polymorphic relations — morphTo / morphMany / morphOne](./plans/2026-05-12-polymorphic-relations.md) — Comments, attachments, reactions, audit logs all want this. No support today.
- [ ] [Through relations — hasManyThrough / hasOneThrough](./plans/2026-05-12-through-relations.md) — Country → Posts through Users requires raw SQL today.
- [ ] [Pivot promotion — allow real Models as the pivot](./plans/2026-05-12-pivot-as-model.md) — `belongsToMany` pivot is always a raw table; can't have extra columns + behaviour on the join.
- [x] [joinWith — honour where-clauses on hasOne/belongsTo constraints](./plans/2026-05-12-joinwith-hasone-belongsto-constraints.md) — Done 2026-05-12. Constraint where-clauses appended to LEFT JOIN's ON clause; LEFT JOIN semantics preserved.
- [x] [Move eager-load hook from buildQuery into QueryBuilder.get()](./plans/2026-05-12-eager-load-hook-in-builder.md) — Done 2026-05-12. Eager-loading runs inside driver `get()` regardless of builder construction path.
- [~] [Type-safe relation names via inference from `static relations`](./plans/2026-05-12-type-safe-relation-names.md) — Groundwork landed 2026-05-12 (relations type narrowed to `RelationDefinition`); full literal-key validation deferred to focused session.

### S4 — Low

- [x] [Single source of truth for loaded relations](./plans/2026-05-12-loaded-relations-single-source.md) — Done 2026-05-12. `defineProperty` getter/setter façade over the Map; both `with()` and `joinWith()` paths use the shared `attachLoadedRelation` helper.
- [⊘] [Relation lifecycle events](./plans/2026-05-12-relation-events.md) — Deferred 2026-05-12; needs a `RelationEvents` API separate from `Model.events()` and pairs naturally with type-safe relation names. Revisit together.
- [⊘] [Per-request relation query cache (opt-in)](./plans/2026-05-12-relation-query-cache.md) — Deferred 2026-05-12; no real consumer driving it. Revisit when a perf complaint surfaces.
- [~] [Defer relation-model resolution with clearer errors](./plans/2026-05-12-model-registry-circular-import.md) — Done 2026-05-12 for error messages + startup verification (`verifyRegisteredRelations`). Defer-resolution Proxy still open.

---

## Migrations & CLI (open — documented as shipped)

Both items below are **documented as-if-shipped** in `docs/`. The docs initiative ships referencing them; the implementation is queued separately. Same pattern used (and resolved) for the relation decorators above.

### S2 — High

- [x] **`npx cascade migrate` CLI binary** — **Done 2026-05-23** (decision [`#10`](./design/decisions.md), plan [`2026-05-22-operations-api-and-cli.md`](./plans/2026-05-22-operations-api-and-cli.md)). Cascade now ships a citty-based `cascade` bin plus an **Operations API** (`runMigrations` / `rollbackMigrations` / `freshMigrate` / `exportMigrationsSQL` / `listExecutedMigrations` / `createDatabase` / `dropAllTables`) consumed by both the standalone binary and warlock-core's CLI — one code path, two surfaces. Standalone is env-driven (`DATABASE_URL` / `DB_*`, plus `CASCADE_PRIMARY_KEY` / `CASCADE_UUID_STRATEGY` for migration defaults). Shipped subcommands: `cascade migrate` (`-f`, `--sql`, `--pending-only`, `--compact`, `-p`), `migrate:list`, `migrate:rollback` (`--all`, `--batches`), `migrate:export-sql`. User docs: [`docs/guides/cli.md`](./docs/guides/cli.md) + [`docs/reference/operations-api.md`](./docs/reference/operations-api.md).

- [ ] **`Migration.createTrash(SourceModel)` helper for PG soft-delete-via-trash** — `docs/guides/delete-strategies.md` documents the `trash` strategy as working on Postgres. On Mongo it Just Works (collections need no declaration); on PG the trash table must exist before the first delete with strategy `"trash"`. Two paths considered:
  - *Auto-create on first use* — rejected: DDL inside transactions is fragile, app role often lacks CREATE permissions, schema drift is invisible to reviewers.
  - *Explicit migration helper* — accepted. `Migration.createTrash(User)` emits a table mirroring `users` schema + `deletedAt` + `originalTable` columns, with snake/camel naming following the data source's naming convention. Same `Migration.create` ergonomics, separate verb. Until this ships, PG users must hand-write the trash table migration.

## Docs initiative

### S4 — Low

- [ ] **`docs/llms-full.txt` — full-content concat for LLM ingestion** — `docs/llms.txt` (curated index) ships now, regenerated by [`scripts/generate-llms-txt.mjs`](./scripts/generate-llms-txt.mjs). The full-content variant is **deferred until the three as-if-shipped engineering tasks land** (migrate CLI, Mongo join-emulation decision, pivot unification). Rationale: `llms-full.txt` inlines the actual tutorial prose verbatim — an LLM ingesting it wholesale would confidently instruct users to run `npx cascade migrate` etc. before those ship. Build it once framework reality matches the docs, and build it as a generator (extend the existing script with a `--full` mode + a pre-commit/CI regen hook) so it cannot rot.

## Pre-existing backlog

- [x] Introduce decorators for relations: `@HasMany`, `@HasOne`, `@BelongsTo`, `@BelongsToMany`. — Done 2026-05-13. `lazy(() => Model)` form is the canonical answer for circular imports; string-name and direct-class refs also supported. Docs rewrite landed in same commit.
