# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.2.11

### Changed

- Bumped `@mongez/reinforcements` to 3.3.0

## 4.2.10

### Changed

- `ConsoleLog`'s timestamp (and the `↳` context arrow) switch from bright-black `gray` to the 256-color `slate` — recessive but cleanly legible where bright-black read muddy.

## 4.2.9

### Changed

- `ConsoleLog` output retuned for scannability — a time-only `HH:mm:ss.SSS` timestamp dimmed to gray, fixed-width level tags so the columns align, and `fatal` restored to a white-on-bright-red background badge. (`FileLog` / `JSONFileLog` keep the full ISO timestamp.)

## 4.2.8

### Changed

- `ConsoleLog` now prints each level's name beside its icon (`⚙ debug`, `ℹ info`, `⚠ warn`, `✗ error`, `✓ success`, `☠ fatal`) for at-a-glance reading.

## 4.2.0

### Added

- `log.flush()` — awaitable async counterpart to `flushSync()`, draining every channel via `Promise.allSettled` with per-channel isolation. Implemented by `FileLog` / `JSONFileLog`.
- `SentryLog` channel — forwards entries to Sentry (`eventLevels` become events, others breadcrumbs; `module` / `action` as tags). `@sentry/node` is an optional, lazily-imported peer.
- `log.fatal()` + `fatal` level — ranked strictly above `error` for unrecoverable failures; does not auto-flush or exit.
- `ConsoleLog` renders `fatal` with a `☠` icon on a bright-red background, distinct from `error`'s `✗`.

### Changed

- `captureAnyUnhandledRejection()` now escalates `uncaughtException` to `log.fatal` (was `error`); `unhandledRejection` stays at `error`.
- `LoggingData.type` is now typed as `LogLevel` (was a duplicated inline union).
- `LogContract` / `LogChannel` now expose an optional `flush?()` alongside `flushSync?()`.

### Fixed

- `@sentry/node` is referenced only via local types + an indirect dynamic import, so source-served consumers no longer get `TS2307: Cannot find module '@sentry/node'` when they don't install the optional peer.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
