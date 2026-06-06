---
name: logger-basics
description: 'Start with @warlock.js/logger — the log singleton, six levels (debug / info / warn / error / success / fatal), channel fan-out, foundations. Triggers: `log`, `Logger`, `log.info`, `log.error`, `log.fatal`, `log.debug`, `log.warn`, `log.success`, `ConsoleLog`, `FileLog`, `JSONFileLog`; "how do I log in node", "warlock logger basics", "which logger skill do I need"; typical import `import { log, ConsoleLog, FileLog } from "@warlock.js/logger"`. Skip: channel picks — `@warlock.js/logger/pick-log-channel/SKILL.md`; setup — `@warlock.js/logger/configure-logger/SKILL.md`; competing libs `winston`, `pino`, `bunyan`, `log4js`, `signale`; native `console.log`.'
---

# Log with channels

Multi-channel structured logger for Node.js. Four built-in channels (`ConsoleLog`, `FileLog`, `JSONFileLog`, `SentryLog`), an abstract `LogChannel` base for custom sinks, six severity levels, and a safe shutdown path via `Logger.enableAutoFlush(events)` plus async `log.flush()` for network channels.

> This skill is the logger **map** — read it first, then load the specific skill for the task.

## Install

```bash
yarn add @warlock.js/logger
```

## Foundations

The 11 things that are true in every logger use:

1. **Public API is the `log` singleton** (`import { log } from "@warlock.js/logger"`). It's a `Logger` instance — call `log.info(...)`, `log.configure(...)`, etc. No callable `log(data)` form.
2. **The singleton starts with zero channels.** Nothing is written until at least one channel is registered via `addChannel`, `setChannels`, or `configure`.
3. **Custom instances:** `new Logger()` gives an isolated logger with the identical API. Almost always you want the singleton — reach for the class only when you need an isolated channel set (libraries, test sandboxes).
4. **Six levels, closed union:** `"debug" | "info" | "warn" | "error" | "success" | "fatal"`. `fatal` ranks strictly above `error` — use it for unrecoverable failures where the app is going down (failed bootstrap, `uncaughtException`). There are no custom levels.
5. **Channels can be filtered two ways:** a `levels` array (whitelist) and a `filter` predicate (custom logic). Both run on every entry. See [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md).
6. **Logger-wide minimum severity** is available via `log.setMinLevel("info")` (or `configure({ minLevel })`). Entries below the rank are dropped before fan-out — cheaper than per-channel filters.
7. **Redaction** is two-layer additive: `configure({ redact })` sets the logger floor; `new XxxChannel({ redact: { paths: [...] } })` adds more paths on top. Channels can never remove paths from the logger floor. See [`@warlock.js/logger/redact-sensitive-log-fields/SKILL.md`](@warlock.js/logger/redact-sensitive-log-fields/SKILL.md).
8. **`FileLog` and `JSONFileLog` buffer in memory.** They flush when `maxMessagesToWrite` (default `100`) is hit, when 5 seconds have elapsed since the last write, or when `flushSync()` is called. See [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md).
9. **Non-terminal channels receive ANSI-stripped messages.** `Logger.log` shallow-clones the entry per non-terminal channel before stripping, so later terminal channels still get the colored original.
10. **`JSONFileLog.extension` is always `"json"`.** The option is ignored for this channel.
11. **`captureAnyUnhandledRejection()` registers process listeners.** Call it once at startup, after channels are registered. Calling it twice installs duplicate listeners. See [`@warlock.js/logger/capture-unhandled-errors/SKILL.md`](@warlock.js/logger/capture-unhandled-errors/SKILL.md).

## Minimal startup example

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.configure({
  channels: [
    new ConsoleLog(),
    new FileLog({ chunk: "daily", storagePath: "./storage/logs" }),
  ],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});

await log.info("users", "register", "New user created");
await log.error("payments", "charge", new Error("Card declined"));
```

## The six levels

```ts
log.debug("module", "action", "verbose detail");      // dev-only diagnostics
log.info("module", "action", "neutral event");        // user-visible event
log.warn("module", "action", "something off");         // recoverable concern
log.error("module", "action", error);                 // handled failure, app continues
log.success("module", "action", "operation done");    // explicit success
log.fatal("module", "action", error);                 // unrecoverable, app is going down
```

`fatal` is purely informational — it does NOT auto-flush or exit. The caller decides whether to `await log.flush()` and `process.exit(...)`. See [`@warlock.js/logger/capture-unhandled-errors/SKILL.md`](@warlock.js/logger/capture-unhandled-errors/SKILL.md) for the `uncaughtException` → `fatal` routing.

Every call signature is the same — `module`, `action`, `message`, optional `context`. `message` can be a string, object, or `Error` instance (file channels capture the stack).

## Pick a skill

| If the task is about… | Load |
| --- | --- |
| Picking a channel — what each built-in does, when to use which | [`@warlock.js/logger/pick-log-channel/SKILL.md`](@warlock.js/logger/pick-log-channel/SKILL.md) |
| Startup — registering channels, environment-based setup, the `configure` method | [`@warlock.js/logger/configure-logger/SKILL.md`](@warlock.js/logger/configure-logger/SKILL.md) |
| Filtering log output (`levels`, `filter`, per-channel routing, `minLevel`) | [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md) |
| Graceful shutdown — `flushSync`, `autoFlushOn`, signal behavior | [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md) |
| Extending `LogChannel` to build a custom sink (Slack, database, HTTP) | [`@warlock.js/logger/write-custom-log-channel/SKILL.md`](@warlock.js/logger/write-custom-log-channel/SKILL.md) |
| Routing Node's `unhandledRejection` / `uncaughtException` through the logger | [`@warlock.js/logger/capture-unhandled-errors/SKILL.md`](@warlock.js/logger/capture-unhandled-errors/SKILL.md) |
| `log.assert(...)` and `log.timer(...)` shorthand helpers | [`@warlock.js/logger/use-log-helpers/SKILL.md`](@warlock.js/logger/use-log-helpers/SKILL.md) |
| Redacting secrets — logger floor + additive channel paths | [`@warlock.js/logger/redact-sensitive-log-fields/SKILL.md`](@warlock.js/logger/redact-sensitive-log-fields/SKILL.md) |
| Tests that assert on log output, or code under test that logs | [`@warlock.js/logger/test-logging-code/SKILL.md`](@warlock.js/logger/test-logging-code/SKILL.md) |

## Things NOT to do

- Don't try `log(module, action, message)` or `log({...})` directly — `log` is a `Logger` instance, not a function. Use `log.info(...)`, `log.error(...)`, etc., or the explicit `log.log({ type, module, action, message })` for the data-object form.
- Don't set `extension` on `JSONFileLog` — it's hardcoded to `"json"` and your value is silently ignored.
- Don't register multiple `FileLog` instances with the same `name` in the same `storagePath` — the lookup via `log.channel("file")` returns only one, and they'll fight over the same file.
- Don't mix `autoFlushOn: ["SIGINT"]` with your own `process.on("SIGINT", ...)` handler — both fire, and ours re-raises mid-way through your async work.
- Don't `await log.info(...)` expecting the write to be on disk — `FileLog` buffers. Call `log.flushSync()` (or rely on `autoFlushOn`) before the process exits.
- Don't call `captureAnyUnhandledRejection()` more than once — it re-registers listeners every call and your rejections get logged N times.
- Don't shadow the import in local code: `for (const log of logEntries) { ... }` will hide the singleton inside that block. Rename loop variables (`entry`, `record`) when working with logger imports.
