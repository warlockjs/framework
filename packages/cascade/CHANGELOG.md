# Changelog — @warlock.js/cascade

All notable changes to `@warlock.js/cascade` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Added

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
