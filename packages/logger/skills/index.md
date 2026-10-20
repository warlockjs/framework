---
description: 'Structured logging with channels, filtering, redaction and shutdown flushing: `log`, `Logger`, `LogChannel`, `ConsoleLog`, `JSONFileLog`, `SentryLog` and `applyRedact`. Use for "log an error with context", "hide tokens", "write JSON logs", "send errors to Sentry" or "flush before exit". Not this package → @warlock.js/core for HTTP error responses; @warlock.js/ai-panoptic for agent traces and AI cost dashboards.'
---

# @warlock.js/logger

The `log` singleton (a `Logger`) sends each entry, with module, action, level and message, to every configured `LogChannel`. Channels decide where entries go (console, file, JSON file, Sentry, custom) and can filter by level or module.

Works standalone in Node projects; core is not required. Levels are `debug`, `info`, `warn`, `error`, `success`, and `fatal` (above `error`).

## The 80% path

1. Start with `logger-basics.md`.
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

## Server-only package

`@warlock.js/logger`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. This is build-boundary metadata read by `@warlock.js/web`'s Gate A (import resolution) and Gate C (emitted-bundle verification), not application behavior. App code that reaches the client bundle (including page and layout modules) must not value-import `@warlock.js/logger` — Gate A refuses the build. A type-only import (`import type { ... }`) is allowed. Server loaders, controllers, and modules may import it freely.

## When to reach for it

- Building a Node service that needs **structured** logs (key-value pairs, not bare strings) and you want them to land in multiple destinations (console for dev, JSON file for prod, third-party sink for audits) without rewriting the call sites.
- You'd reach for **pino** or **winston** but want a smaller surface that's already wired into Warlock conventions (`module / action / message` shape, redaction floor, signal flush built-in).
- Your team agrees that **`console.log` doesn't survive contact with production** — you need filtering, level routing, channel-specific sinks, and a redaction story before secrets leak into Slack/Datadog.

Skip if your code is a throwaway script where `console.log` is genuinely fine — there's no value in adding a dependency for one-off logs.

## The mental model in one paragraph

You write `log.info("auth", "login", "user signed in", { userId })`. The logger fans that single entry out to every registered channel (`ConsoleLog`, `FileLog`, `JSONFileLog`, `SentryLog`, or your custom subclass). Each channel decides whether to emit it (per-level whitelist, per-channel filter predicate, logger-wide minimum severity). Redaction runs once at the logger level and can be extended per channel — never relaxed. Buffered channels (file + JSON file) drain on flush — synchronously via `log.flushSync()` / `enableAutoFlush(['SIGINT', 'SIGTERM', 'beforeExit'])`, or asynchronously via `await log.flush()` (the only path that works for network channels like `SentryLog`). That's the whole package.

## Built-in channels at a glance

| Channel       | Sink                        | `terminal`              | Buffered                                                                |
| ------------- | --------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `ConsoleLog`  | `process.stdout`            | `true` (colors kept)    | no                                                                      |
| `FileLog`     | `.log` files                | `false` (ANSI stripped) | yes (5s timer or 100-entry buffer)                                      |
| `JSONFileLog` | `.json` files               | `false` (ANSI stripped) | yes (same buffering)                                                    |
| `SentryLog`   | Sentry events + breadcrumbs | `false`                 | via the Sentry SDK's own transport (`@sentry/node` is an optional peer) |

`terminal: true` is the flag that decides whether the channel sees raw colored messages or stripped plain text. Custom channels: pick `true` if you write to a terminal, `false` for anything else.

## What this package deliberately doesn't do

- **Distributed tracing.** Use OpenTelemetry. Logger gets you structured local logs with `module / action`; trace correlation is a different problem.
- **Log aggregator integrations beyond Sentry.** `SentryLog` is bundled (with `@sentry/node` as an optional peer). For Datadog, Loki, ELK, etc., either write a custom channel that POSTs to the aggregator or use `JSONFileLog` + a sidecar (fluentbit, vector, promtail).
- **Pretty-printing of arbitrary objects.** `ConsoleLog` has a `showContext` flag that runs `util.inspect` on the context object; for richer formatting, use `JSONFileLog` and view the file through your favorite viewer.
- **Log analysis.** Querying / aggregating / alerting is on the sink side (Loki, ELK, Datadog).

## See also

- The `warlock-conventions` topic of the `warlock-js-core` skill — the parent framework's conventions; logger is one of its foundation packages and ships transitively when you install core.
