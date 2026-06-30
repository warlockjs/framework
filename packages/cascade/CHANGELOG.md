# Changelog — @warlock.js/cascade

All notable changes to `@warlock.js/cascade` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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
