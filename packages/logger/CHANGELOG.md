# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

### Added

- **`log.flush()`** — an asynchronous, awaitable counterpart to `flushSync()`. It drains every channel that implements `flush()`, each isolated via `Promise.allSettled` so one channel's failure can neither break shutdown nor escape as an unhandled rejection. Use it on a graceful-shutdown path (`await log.flush()`) for channels whose delivery is async. `LogContract` and the `LogChannel` base now expose an optional `flush?()`; `FileLog` and `JSONFileLog` implement it (`ConsoleLog` writes synchronously and needs none). `autoFlushOn` continues to use `flushSync()`.
- **`SentryLog`** channel — forwards entries to Sentry. Entries at `eventLevels` (`error` / `warn` by default) become events (`captureException` for `Error` messages, `captureMessage` otherwise); every other level becomes a breadcrumb, costing no error quota. `module` / `action` are attached as tags and `context` as a structured Sentry context. `@sentry/node` is an **optional peer**, lazily imported — pass an existing `client` (reused as-is) or `options` (the channel initializes Sentry). `flush()` drains pending events via `Sentry.flush(timeout)`.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
