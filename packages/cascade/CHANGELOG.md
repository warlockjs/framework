# Changelog — @warlock.js/cascade

All notable changes to `@warlock.js/cascade` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.0

### Changed

- MongoDB and PostgreSQL drivers now log a failed initial `connect()` at `log.fatal` (was `log.error`). Boot-time database connection failures are unrecoverable in every realistic Warlock use case (app boot, CLI migrations, workers) — `fatal` makes "page on fatal only" alerting clean. Per-query failures, `createDatabase`/`dropDatabase` lifecycle errors, and disconnect failures stay at `error`.

### Fixed

- PostgreSQL `increment` / `decrement` (and the `*Many` variants) bound the amount parameter as `$1`, which collided with the first filter placeholder (`SET n = n + $1 WHERE id = $1`) — the filter value bound into the amount slot, so every filtered counter update wrote the wrong number. The amount now binds after the filter params.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
