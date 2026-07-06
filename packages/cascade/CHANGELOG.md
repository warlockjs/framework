# Changelog — @warlock.js/cascade

All notable changes to `@warlock.js/cascade` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.7.0

### Added

- `lockForUpdate({ skipLocked?, noWait? })` — row locking on SELECT (`FOR UPDATE [SKIP LOCKED | NOWAIT]`), the concurrent job-queue claim shape; Postgres-only, the MongoDB driver throws
- `DatabaseDriverContract.supportsSqlSerialization` — capability flag (default `true`); `false` routes the MigrationRunner through direct migration-driver execution

### Fixed

- Postgres model-level `sum`/`avg`/`min`/`max`/`distinct`/`countDistinct`/`pluck`/`value` no longer return `0`/`undefined` — the hydration callback is reset before reading, matching MongoDB
- Postgres `Model.findAndUpdate` / `Model.atomic` now update every matching row instead of one arbitrary row (a hidden `LIMIT 1`; MongoDB was already multi-row)
- Postgres query-builder `update()` / `unset()` now honor the chained `where` filter — previously they updated the whole table
- Postgres query-builder `deleteOne()` deletes exactly one row — the internal `limit(1)` was silently ignored, deleting every matching row
- Postgres pivot `detach(ids)` (and `sync` / `toggle`) works — the driver translates Mongo-style filter operators (`$in`, `$nin`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`) instead of binding the operator object literally
- CHECK constraints are no longer silently dropped on the MigrationRunner SQL path — the Postgres serializer emits `ADD CONSTRAINT ... CHECK` for `this.check(...)` and column `.check(...)`
- MongoDB `with()` eager loading is no longer a silent no-op — `get()` runs the relation loader, same wiring as Postgres
- MongoDB pipelines order `$match` before `$project` (SQL semantics), so `select()` before `where()` no longer strips the filter column and returns `[]` — fixes pivot `attach` de-duplication and `sync` / `toggle` deltas
- The MigrationRunner works on MongoDB — migrations execute directly through the migration driver; `exportSQL` stays SQL-only with a clear unsupported error
- MongoDB `dropIndex(table, name)` honors the literal index name — the string form is no longer rewritten to `<name>_1` (the columns-array form keeps the convention name)
- `addGlobalScope` / `addLocalScope` register per-subclass — a scope added on one model (e.g. a soft-delete `notDeleted`) no longer leaks onto every other model

## 4.6.1

### Fixed

- Native Postgres array columns (`TEXT[]` / `JSONB[]`, from `arrayText()` / `arrayJson()`) are now auto-detected by introspecting the schema on connect and bound as raw arrays — no more "malformed array literal" on insert and no need to hand-list `nativeArrayColumns` (which stays as an optional per-connection override, now consulted per-table)
- `transaction()` now flat-nests: a nested `transaction()` joins the active one (same session, sees its uncommitted writes) instead of opening a second, independent transaction — fixes phantom foreign-key violations when a service that opens its own transaction is called inside an outer one (e.g. a seeder creating a row, then a service inserting a child that references it). MongoDB joins too, replacing its "nested not supported" throw

## 4.6.0

### Added

- Fast bulk `Model.createMany(data, options?: { batchSize?; bulk? })` — both paths chunk by `batchSize` (default 500); `bulk: true` routes each chunk to the driver's native multi-row `insertMany` for 10–100× throughput (skips per-row hooks/events; default path preserves them)
- `IdGeneratorContract.generateNextIds({ table, count })` — reserve a contiguous block of auto-increment ids in a SINGLE atomic op (MongoDB). `Model.createMany` (default + bulk) now reserves one id block per chunk instead of one counter round-trip per row; engages only for fixed-increment, auto-generated, id-less rows (random-increment or caller-supplied-id rows fall back to per-row generation)
- `QueryBuilder.groupByDate(column, unit, aggregates?)` — portable date-bucketed `GROUP BY` (`day`/`week`/`month`/`year`) across Postgres `date_trunc` and MongoDB `$dateTrunc`
- `$agg.sum(expr)` now also accepts a typed column expression (`$expr.mul`/`$expr.add`/`$expr.sub`/`$expr.div`/`$expr.col`/`$expr.lit`) so you can sum `price * quantity`; bare-string payload is unchanged. Added `$agg.sumRaw(expression)` raw escape hatch (Postgres `SUM(<raw>)`; throws on MongoDB)
- Column-expression DSL grouped under a single `$expr` object (mirroring `$agg`) — `$expr.col` / `$expr.lit` / `$expr.mul` / `$expr.add` / `$expr.sub` / `$expr.div` / `$expr.raw` — plus `isColumnExpression` / `toColumnExpression` and the `ColumnExpression` / `ColumnExpressionInput` types
- MongoDB id counter (`MasterMind`) now has a lazily-ensured unique index on `{ collection: 1 }` plus a bounded retry on duplicate-key (E11000), closing the cold-start race where two concurrent first inserts into a new collection could reserve overlapping ids/blocks
- `$agg.countDistinct(field)` — a cross-driver grouped distinct-count aggregate (Postgres `COUNT(DISTINCT col)`; MongoDB `$addToSet` in `$group` finalized with `$size` in the renaming `$project`)
- `Model.raw<T>(sql, params)` — typed, transaction-aware raw query that auto-joins the active `transaction()` scope and returns `RawQueryResult<T>`
- `DataSource.raw<T>(sql, params)` — thin transaction-aware passthrough to `driver.query`
- Postgres connection option `nativeArrayColumns` — opt out listed columns (`JSONB[]`/`TEXT[]`/…) from JSON-text encoding so genuine native-array columns keep their `{...}` literal form

### Changed

- `DriverContract.query<T>()` is now typed `Promise<RawQueryResult<T>>` (new `rows` + `rowCount` result type) instead of `Promise<any>`

### Fixed

- Postgres `json`/`jsonb` columns no longer corrupt: object-arrays, string-arrays, mixed arrays, empty `[]` (previously stored as `{}`), and plain objects are now JSON-encoded before binding instead of falling through to a Postgres array literal; the same encoding is applied on the UPDATE `$set` path. The pgvector all-number array form is preserved.
- Insert no longer overwrites a caller-supplied `createdAt` — a backdated value (imports/migrations) is now honored, mirroring the upsert guard, while `updatedAt` is always stamped at persist time
- Insert validation now whitelists the system columns (`id`/`_id`/timestamps/`deletedAt`) like the update path, so a backdated `createdAt` survives strict `strip`/`fail` mode instead of being dropped before reaching the writer
- Corrected the MongoDB id-generator docs that falsely claimed the counter write "participates in active transactions" — it is a standalone, immediately-durable write (no transaction session is attached), so a rolled-back insert leaves the consumed id as a gap, exactly like SQL `SERIAL`

## 4.4.0 - 2026-06-21

### Changed

- **Documented `model.uuid`** — the accessor returns the model's primary id as `string` (where `model.id` is `string | number`); the name is historical and performs no UUID validation.

## 4.2.11

### Added

- `Migration.create` auto-wires the `deletedAt` column when the model's delete strategy is `"soft"` (opt out with `{ softDeletes: false }`)

### Changed

- Require `@mongez/reinforcements` ≥ 3.3.0 — the update validator now uses its new `when` helper for conditional schema fields

### Fixed

- Soft `destroy()` now sets `deletedAt` on the in-memory model — the instance was left stale before
- Update validation no longer strips or rejects the `deletedAt` column under strict mode (now whitelisted like the timestamps)

## 4.2.1

### Fixed

- Ship the `bin` folder so the `cascade` CLI works from the published package — it was omitted from the 4.2.0 build.

## 4.2.0

### Changed

- MongoDB and PostgreSQL drivers now log a failed initial `connect()` at `log.fatal` (was `log.error`) — a boot-time database connection failure is unrecoverable, so `fatal` keeps "page on fatal only" alerting clean. Per-query and disconnect failures stay at `error`.

### Fixed

- PostgreSQL `increment` / `decrement` (and the `*Many` variants) bound the amount as `$1`, colliding with the first filter placeholder (`SET n = n + $1 WHERE id = $1`) so every filtered counter update wrote the wrong number; the amount now binds after the filter params.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
