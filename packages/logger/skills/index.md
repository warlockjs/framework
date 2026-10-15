---
description: "Structured logging for Warlock.js with pluggable channels, redaction and shutdown flushing. Exports `log`, `Logger`, `LogChannel`, `ConsoleLog`, `FileLog`, `JSONFileLog`, `SentryLog`, `applyRedact`, `DEFAULT_REDACT_KEYS`, `captureAnyUnhandledRejection`. Use for: \"log an error with context\", \"write logs to a file as JSON\", \"send errors to Sentry\", \"hide passwords and tokens in logs\", \"flush logs before exit\", \"catch unhandled rejections\", \"write my own log channel\". Not this package: HTTP request handling and error responses live in @warlock.js/core; scheduled jobs are @warlock.js/scheduler."
---
# @warlock.js/logger

The `log` singleton (a `Logger`) sends each entry, with module, action, level and message, to every configured `LogChannel`. Channels decide where entries go (console, file, JSON file, Sentry, custom) and can filter by level or module.

## The 80% path
1. Orient: `overview.md`, `logger-basics.md`.
2. Pick channels: `pick-log-channel.md`; set them up: `configure-logger.md`.
3. Log via `log.info/warn/error` or helpers: `use-log-helpers.md`.
4. Redact secrets: `redact-sensitive-log-fields.md`; narrow output: `filter-log-entries.md`.
5. Production safety: `capture-unhandled-errors.md`, `flush-logs-on-shutdown.md`, `ship-logs-to-sentry.md`.
6. Extend or test: `write-custom-log-channel.md`, `test-logging-code.md`.

## Conventions and pitfalls
- `fatal` does not flush or exit by itself; the caller awaits `log.flush()` and then exits.
- File channels buffer, so an unflushed process exit loses the tail of the log.
- Configure redaction before logging request bodies or auth data; the default key set is a floor, not a guarantee.
- Log structured context objects rather than interpolated strings, so channels and Sentry can index them.
