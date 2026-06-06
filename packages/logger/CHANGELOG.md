# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

### Added

- **`fatal` level + `log.fatal()` shortcut** — a sixth severity ranked strictly above `error`, for unrecoverable failures where the app is going down (failed bootstrap, an `uncaughtException`). `LogLevel` is now `"debug" | "info" | "warn" | "error" | "success" | "fatal"`. `fatal` does NOT auto-flush or exit — the caller decides (typically `await log.flush()` then `process.exit(...)`). `LoggingData.type` is now typed as `LogLevel` (was a duplicated inline union — code-standards cleanup).
- **`captureAnyUnhandledRejection()` now escalates `uncaughtException` to `log.fatal`** (was `log.error`). An uncaught exception terminates Node by default, so it's semantically fatal — this makes "page only on fatal" alerting clean. `unhandledRejection` stays at `log.error` (not always process-ending).
- **`ConsoleLog`** renders `fatal` with a `☠` icon on a bright-red background and a bold red-bright message, distinct from `error`'s `✗`.
- **`SentryLog`** maps `fatal` → Sentry severity `"fatal"` (1:1) and includes it in the default `eventLevels` (`["fatal", "error", "warn"]`).

## 4.2.0

### Added

- **`log.flush()`** — an asynchronous, awaitable counterpart to `flushSync()`. It drains every channel that implements `flush()`, each isolated via `Promise.allSettled` so one channel's failure can neither break shutdown nor escape as an unhandled rejection. Use it on a graceful-shutdown path (`await log.flush()`) for channels whose delivery is async. `LogContract` and the `LogChannel` base now expose an optional `flush?()`; `FileLog` and `JSONFileLog` implement it (`ConsoleLog` writes synchronously and needs none). `autoFlushOn` continues to use `flushSync()`.
- **`SentryLog`** channel — forwards entries to Sentry. Entries at `eventLevels` (`error` / `warn` by default) become events (`captureException` for `Error` messages, `captureMessage` otherwise); every other level becomes a breadcrumb, costing no error quota. `module` / `action` are attached as tags and `context` as a structured Sentry context. `@sentry/node` is an **optional peer**, lazily imported — pass an existing `client` (reused as-is) or `options` (the channel initializes Sentry). `flush()` drains pending events via `Sentry.flush(timeout)`.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
