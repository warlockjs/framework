---
name: overview
description: 'Front-door orientation for `@warlock.js/logger` — structured channel-based logging with six severity levels (debug / info / warn / error / success / fatal), PII redaction floor, buffered file/JSON channels, optional SentryLog forwarding, async log.flush() + signal-flush on shutdown, ergonomic helpers (timer, assert). Standalone — no `@warlock.js/core` required. TRIGGER when: code imports anything from `@warlock.js/logger`; user asks "what does @warlock.js/logger do", "compare with pino / winston / bunyan", "structured logging for Node", "which logger should I use", "how do channels work"; package.json adds `@warlock.js/logger`. Skip: specific task already known — load the matching task skill directly (`logger-basics`, `configure-logger`, `pick-log-channel`, `write-custom-log-channel`, `ship-logs-to-sentry`, `redact-sensitive-log-fields`, `filter-log-entries`, `flush-logs-on-shutdown`, `capture-unhandled-errors`, `use-log-helpers`, `test-logging-code`); plain `console.log` in throwaway scripts.'
---

# `@warlock.js/logger` — overview

Structured logging for Node. Six severity levels (with `fatal` strictly above `error`), a singleton plus a `Logger` class, channel-based fan-out (one entry → many sinks), PII redaction as a floor that channels can extend, buffered file writes with signal-triggered flush on shutdown, an awaitable async `log.flush()` for network/async channels, an optional Sentry channel, and a couple of ergonomic helpers (`timer`, `assert`) that turn boilerplate into one-liners.

Ships standalone — `@warlock.js/core` is not required. Drop it into any Node project.

## When to reach for it

- Building a Node service that needs **structured** logs (key-value pairs, not bare strings) and you want them to land in multiple destinations (console for dev, JSON file for prod, third-party sink for audits) without rewriting the call sites.
- You'd reach for **pino** or **winston** but want a smaller surface that's already wired into Warlock conventions (`module / action / message` shape, redaction floor, signal flush built-in).
- Your team agrees that **`console.log` doesn't survive contact with production** — you need filtering, level routing, channel-specific sinks, and a redaction story before secrets leak into Slack/Datadog.

Skip if your code is a throwaway script where `console.log` is genuinely fine — there's no value in adding a dependency for one-off logs.

## The mental model in one paragraph

You write `log.info("auth", "login", "user signed in", { userId })`. The logger fans that single entry out to every registered channel (`ConsoleLog`, `FileLog`, `JSONFileLog`, `SentryLog`, or your custom subclass). Each channel decides whether to emit it (per-level whitelist, per-channel filter predicate, logger-wide minimum severity). Redaction runs once at the logger level and can be extended per channel — never relaxed. Buffered channels (file + JSON file) drain on flush — synchronously via `log.flushSync()` / `enableAutoFlush(['SIGINT', 'SIGTERM', 'beforeExit'])`, or asynchronously via `await log.flush()` (the only path that works for network channels like `SentryLog`). That's the whole package.

## Skills index

Eleven task skills cover everything. Load the one that matches your job — most callers only ever need `logger-basics` + `configure-logger` + `pick-log-channel`.

### Foundations

#### [`logger-basics`](@warlock.js/logger/logger-basics/SKILL.md)
Start here. The `log` singleton, the six levels (`debug` / `info` / `warn` / `error` / `success` / `fatal`), how fan-out works, the `module / action / message / context` shape every entry carries.

#### [`configure-logger`](@warlock.js/logger/configure-logger/SKILL.md)
Wire channels at boot — `log.addChannel`, `log.setChannels`, `log.configure({ channels, autoFlushOn, redact, minLevel })`. Branch on `NODE_ENV`, replace the channel list, isolate a library's logger from the host singleton.

### Channels

#### [`pick-log-channel`](@warlock.js/logger/pick-log-channel/SKILL.md)
Pick one of the four built-ins: `ConsoleLog` (terminal, colored), `FileLog` (plain `.log` on disk with rotation), `JSONFileLog` (structured JSON for aggregators — Datadog, Loki, ELK), `SentryLog` (errors + breadcrumbs to Sentry; `@sentry/node` is an optional peer).

#### [`ship-logs-to-sentry`](@warlock.js/logger/ship-logs-to-sentry/SKILL.md)
The `SentryLog` channel in depth — event-vs-breadcrumb level mapping, dual init modes (reuse an existing client or pass `options`), draining via `Sentry.flush(timeout)`, behavior when the optional peer isn't installed.

#### [`write-custom-log-channel`](@warlock.js/logger/write-custom-log-channel/SKILL.md)
Extend `LogChannel<Options>` for sinks the built-ins don't cover — Slack, HTTP endpoint, in-memory buffer, database. The lazy `init()` lifecycle (`setTimeout(0)`), the `terminal: true/false` ANSI-stripping behavior, and the difference between `flush()` (async, network) and `flushSync()` (sync, files) are subtle — read this skill before subclassing.

### Production concerns

#### [`redact-sensitive-log-fields`](@warlock.js/logger/redact-sensitive-log-fields/SKILL.md)
Strip secrets before they reach a sink. Logger-wide `setRedact({ paths, censor })` is the security floor; per-channel `redact` configs add paths (never remove). Dotted-glob paths (`*`, `**`); censor as string or function `(value, path) => any`.

#### [`filter-log-entries`](@warlock.js/logger/filter-log-entries/SKILL.md)
Drop entries before they cost anything. Logger-wide `setMinLevel("info")` is the fast path; per-channel `levels` array + `filter` predicate for fine control.

#### [`flush-logs-on-shutdown`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md)
Buffered channels need explicit drain. `log.flushSync()` (sync) for file channels — also wired by `enableAutoFlush(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'SIGUSR2', 'beforeExit'])`. `await log.flush()` (async) for network/async channels like `SentryLog` — the only path that can await an HTTPS round-trip on a graceful shutdown.

#### [`capture-unhandled-errors`](@warlock.js/logger/capture-unhandled-errors/SKILL.md)
`captureAnyUnhandledRejection()` hooks `unhandledRejection` (→ `log.error("app", ...)`) and `uncaughtException` (→ `log.fatal("app", ...)` — Node terminates by default, so it's semantically fatal). One call at startup, pair with `autoFlushOn: ['beforeExit']` to land the entry on disk.

### Ergonomics + testing

#### [`use-log-helpers`](@warlock.js/logger/use-log-helpers/SKILL.md)
Two shortcuts every `Logger` exposes: `log.assert(condition, module, action, message, context?)` logs an error only when the condition is falsy (free on the happy path); `log.timer(module, action)` returns an end-function that emits `info` with a measured `durationMs`.

#### [`test-logging-code`](@warlock.js/logger/test-logging-code/SKILL.md)
Silence the logger globally in tests via `log.setChannels([])` in `setupFiles`. Assert specific entries with a capturing `LogChannel` subclass — it proves an entry was actually delivered through the pipeline (filters, redaction), not merely that a method was called, and it isolates cleanly by swapping `log.channels`.

## Built-in channels at a glance

| Channel | Sink | `terminal` | Buffered |
| --- | --- | --- | --- |
| `ConsoleLog` | `process.stdout` | `true` (colors kept) | no |
| `FileLog` | `.log` files | `false` (ANSI stripped) | yes (5s timer or 100-entry buffer) |
| `JSONFileLog` | `.json` files | `false` (ANSI stripped) | yes (same buffering) |
| `SentryLog` | Sentry events + breadcrumbs | `false` | via the Sentry SDK's own transport (`@sentry/node` is an optional peer) |

`terminal: true` is the flag that decides whether the channel sees raw colored messages or stripped plain text. Custom channels: pick `true` if you write to a terminal, `false` for anything else.

## What this package deliberately doesn't do

- **Distributed tracing.** Use OpenTelemetry. Logger gets you structured local logs with `module / action`; trace correlation is a different problem.
- **Log aggregator integrations beyond Sentry.** `SentryLog` is bundled (with `@sentry/node` as an optional peer). For Datadog, Loki, ELK, etc., either write a custom channel that POSTs to the aggregator or use `JSONFileLog` + a sidecar (fluentbit, vector, promtail).
- **Pretty-printing of arbitrary objects.** `ConsoleLog` has a `showContext` flag that runs `util.inspect` on the context object; for richer formatting, use `JSONFileLog` and view the file through your favorite viewer.
- **Log analysis.** Querying / aggregating / alerting is on the sink side (Loki, ELK, Datadog).

## See also

- [`@warlock.js/core/warlock-conventions`](@warlock.js/core/warlock-conventions/SKILL.md) — the parent framework's conventions; logger is one of its foundation packages and ships transitively when you install core.
- When synced via agent-kit, this `overview/SKILL.md` is flattened to the front-door skill `.claude/skills/warlock-js-logger-overview/` — every cross-link above uses the `@warlock.js/logger/<skill>/SKILL.md` name form so it survives that flattening.
