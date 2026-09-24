---
name: configure-logger
description: 'Register channels via log.addChannel / log.setChannels / log.configure({channels, autoFlushOn, redact, minLevel}) at boot. Triggers: `log.configure`, `log.addChannel`, `log.setChannels`, `Logger`, `autoFlushOn`, `disableAutoFlush`; "wire channels at startup", "branch logger by NODE_ENV", "isolate a library''s logger", "replace channel list"; typical import `import { log, Logger, ConsoleLog, FileLog } from "@warlock.js/logger"`. Skip: channel picks — `@warlock.js/logger/pick-log-channel/SKILL.md`; flushing — `@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`; redaction — `@warlock.js/logger/redact-sensitive-log-fields/SKILL.md`; competing libs `winston.createLogger`, `pino`.'
---

# Setup — registering channels at startup

The logger is a singleton. Do all setup in one place, as early in the app entry point as possible.

## The three channel-registration methods

| Method | Semantics |
|---|---|
| `log.addChannel(channel)` | **Appends.** Safe to call multiple times. |
| `log.setChannels([...])` | **Replaces** the full list. |
| `log.configure({ channels, autoFlushOn, redact, minLevel })` | **Replaces** channels if provided; installs auto-flush if provided; sets redact / minLevel if provided. All four are optional. |

All three return `this` — chainable.

## Recommended pattern — one dedicated file

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog, JSONFileLog } from "@warlock.js/logger";

if (process.env.NODE_ENV === "production") {
  log.configure({
    channels: [
      new FileLog({ storagePath: "./storage/logs", chunk: "daily", rotate: true }),
      new JSONFileLog({ storagePath: "./storage/logs-json", chunk: "daily" }),
    ],
    autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
  });
} else if (process.env.NODE_ENV === "test") {
  log.setChannels([]);   // silence logger during tests
} else {
  log.setChannels([new ConsoleLog()]);
}
```

Import it once at the top of `src/index.ts`:

```ts title="src/index.ts"
import "./logger";                     // side-effect: configures singleton
import { log } from "@warlock.js/logger";

log.info("app", "start", "Server listening on :3000");
```

## What `configure({ autoFlushOn })` does

Registers one process-level handler per event that calls `log.flushSync()` before Node exits. See [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md) for the full behavior table.

```ts
log.configure({
  channels: [new FileLog()],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
// Now a buffered FileLog flushes on Ctrl+C, container stop, and natural exit.
```

Calling `configure({ autoFlushOn })` a second time **replaces** previous handlers (not stacks them). Call `log.disableAutoFlush()` to tear them down.

## Creating an isolated Logger

Rarely needed. Useful when a library wants its own channel list that doesn't share with the host app:

```ts
import { Logger, ConsoleLog } from "@warlock.js/logger";

export const libraryLogger = new Logger();
libraryLogger.addChannel(new ConsoleLog({ filter: (d) => d.module === "my-lib" }));
```

Every `new Logger()` gets a unique `id` (string, prefixed `"logger-"`).

## Order matters — ANSI stripping across channels

`Logger.log` shallow-clones the entry per non-terminal channel before stripping ANSI codes. Registering a terminal channel (ConsoleLog) **after** a non-terminal one (FileLog) still works — ConsoleLog sees the original colored message. But if you register them in reverse and add a channel that mutates `data` in place, the non-terminal channel will see the terminal channel's version. Prefer the built-ins; custom channels should not mutate `data`.

## When to call what

- **`addChannel`** — most common. Add channels as you discover you need them during setup.
- **`setChannels`** — when env branching makes the full list clear at once (production vs dev).
- **`configure`** — when you also want to install auto-flush, redact, or minLevel in the same call.

## Combining everything

```ts
log.configure({
  channels: [
    new ConsoleLog({ showContext: true }),
    new FileLog({ chunk: "daily" }),
  ],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
  redact: { paths: ["context.password", "context.headers.authorization"] },
  minLevel: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
});
```

See [`@warlock.js/logger/redact-sensitive-log-fields/SKILL.md`](@warlock.js/logger/redact-sensitive-log-fields/SKILL.md) for the redact contract and [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md) for `minLevel`.

## See also

- [`@warlock.js/logger/pick-log-channel/SKILL.md`](@warlock.js/logger/pick-log-channel/SKILL.md) — what each built-in channel does
- [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md) — `autoFlushOn` event behavior
