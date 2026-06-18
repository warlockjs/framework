# Changelog — @warlock.js/cascade

All notable changes to `@warlock.js/cascade` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

### Added

- `model.uuid` documented — a string-typed accessor returning the primary id as `string` (where `model.id` is `string | number`); name is historical, no UUID validation

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

- MongoDB and PostgreSQL drivers now log a failed initial `connect()` at `log.fatal` (was `log.error`). Boot-time database connection failures are unrecoverable in every realistic Warlock use case (app boot, CLI migrations, workers) — `fatal` makes "page on fatal only" alerting clean. Per-query failures, `createDatabase`/`dropDatabase` lifecycle errors, and disconnect failures stay at `error`.

### Fixed

- PostgreSQL `increment` / `decrement` (and the `*Many` variants) bound the amount parameter as `$1`, which collided with the first filter placeholder (`SET n = n + $1 WHERE id = $1`) — the filter value bound into the amount slot, so every filtered counter update wrote the wrong number. The amount now binds after the filter params.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
