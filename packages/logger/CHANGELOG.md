# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.0

### Added

- `log.flush()` — awaitable async counterpart to `flushSync()`. Drains every channel that implements `flush()` via `Promise.allSettled` with per-channel isolation, so one channel's failure can't break shutdown. `FileLog` / `JSONFileLog` implement it; `ConsoleLog` writes synchronously and doesn't need it.
- `SentryLog` channel — forwards entries to Sentry. `eventLevels` (`fatal` / `error` / `warn` by default) become events (`captureException` for `Error` messages, `captureMessage` otherwise); every other level becomes a breadcrumb. `module` / `action` are tags, `context` is a structured Sentry context. `@sentry/node` is an **optional peer**, lazily imported — pass an existing `client` or `options`.
- `log.fatal()` + `fatal` log level — ranked strictly above `error` for unrecoverable failures (failed bootstrap, `uncaughtException`). Does not auto-flush or exit; caller decides.
- `ConsoleLog` renders `fatal` with a `☠` icon on a bright-red background and bold red-bright message, distinct from `error`'s `✗`.

### Changed

- `captureAnyUnhandledRejection()` now escalates `uncaughtException` to `log.fatal` (was `log.error`). Node terminates the process by default, so it's semantically fatal — makes "page only on fatal" alerting clean. `unhandledRejection` stays at `error`.
- `LoggingData.type` is now typed as `LogLevel` (was a duplicated inline union — code-standards cleanup).
- `LogContract` and the `LogChannel` base now expose an optional `flush?()` alongside the existing `flushSync?()`.

### Fixed

- `@sentry/node` is now referenced only via local minimal types + an indirect dynamic import, so source-served consumers (the package's `main` → `./src/index.ts`) no longer get a `TS2307: Cannot find module '@sentry/node'` when they (correctly) don't install the optional peer. Proven by pruning the SDK and running the full suite + `tsc --noEmit` clean.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
