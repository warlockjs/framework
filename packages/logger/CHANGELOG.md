# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.10

### Changed

- `ConsoleLog`'s timestamp (and the `↳` context arrow) switch from bright-black `gray` to the 256-color neutral `slate`. Bright-black sits too close to the background on most terminal themes and reads muddy; `slate` is recessive but cleanly legible.

## 4.2.9

### Changed

- `ConsoleLog` output is retuned for scannability:
  - **Time-only timestamp** (`HH:mm:ss.SSS`) instead of the full ISO string — within a dev session the date is just noise. Persistent channels (`FileLog` / `JSONFileLog`) still record the full ISO timestamp.
  - The timestamp moves from yellow to **gray** so the colored level + message lead the eye; `module` (cyan) and `action` (magenta) keep their colors for at-a-glance subsystem scanning.
  - **Aligned columns** — each level tag is padded to a fixed width so the timestamp / module / action columns line up vertically across a stream of logs.
  - **`fatal` is restored to a background badge** — white, bold text on a bright-red background (`☠ fatal`), the same column width as the other tags but deliberately louder than `error`'s plain red, so an unrecoverable failure can't be missed (4.2.8 had briefly flattened it to a plain label).

## 4.2.8

### Changed

- `ConsoleLog` now prints the level name beside each level's icon — `⚙ debug`, `ℹ info`, `⚠ warn`, `✗ error`, `✓ success`, `☠ fatal` — so entries are readable at a glance without memorizing icons. `fatal` also switches from a bright-red **background** badge to a bold red-bright `☠ fatal` label, consistent with the other levels.

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
