---
title: "Logger"
description: "The Logger class and the log singleton — every public method, signature, and field."
sidebar:
  order: 1
  label: "Logger"
---

`Logger` is the central orchestrator. It holds a list of channels and forwards every log call to all of them. `log` is the pre-instantiated singleton exported from the package.

:::note
`Logger` starts with **no channels**. Register at least one via `addChannel` or `setChannels` before any output is produced.
:::

## Quick lookup

| I want to… | Use |
| --- | --- |
| Log at info level | `log.info("module", "action", "message")` |
| Register a channel | `log.addChannel(myChannel)` |
| Retrieve a channel by name | `log.channel("console")` |
| Drop everything below a severity | `log.setMinLevel("info")` |
| Strip secrets from every entry | `log.setRedact({ paths: ["context.password"] })` |
| Time how long an operation took | `const end = log.timer("db", "query"); end()` |
| Log an error if a condition fails | `log.assert(condition, "module", "action", "message")` |

## Methods

| Method | Signature | Description |
| --- | --- | --- |
| `addChannel` | `(channel: LogChannel): this` | Register a new channel. Chainable. |
| `setChannels` | `(channels: LogChannel[]): this` | Replace the full channel list. |
| `configure` | `(config: { channels?: LogChannel[]; autoFlushOn?: AutoFlushEvent[]; minLevel?: LogLevel; redact?: RedactConfig }): this` | One-shot setup: channel list, auto-flush handlers, severity floor, redaction floor. Every field optional. |
| `log` | `(data: LoggingData): Promise<this>` | Pass a fully formed `LoggingData` object through all channels. |
| `debug` | `(dataOrModule: OmittedLoggingData \| string, action?: string, message?: any, context?: Record<string, any>): Promise<this>` | Log at `debug`. |
| `info` | `(dataOrModule, action?, message?, context?): Promise<this>` | Log at `info`. |
| `warn` | `(dataOrModule, action?, message?, context?): Promise<this>` | Log at `warn`. |
| `error` | `(dataOrModule, action?, message?, context?): Promise<this>` | Log at `error`. |
| `success` | `(dataOrModule, action?, message?, context?): Promise<this>` | Log at `success`. |
| `assert` | `(condition: unknown, module: string, action: string, message: any, context?: Record<string, any>): Promise<this> \| this` | Log an `error` entry when `condition` is falsy; genuinely free no-op when truthy. |
| `timer` | `(module: string, action: string): (extra?: Record<string, any>) => Promise<this>` | Start a duration timer. The returned function emits an `info` entry with `completed in <ms>ms` and a `durationMs` field in `context`. |
| `channel` | `(name: string): LogChannel \| undefined` | Find a registered channel by its `name` property. |
| `flushSync` | `(): void` | Synchronously invoke `flushSync()` on every channel that implements it. |
| `enableAutoFlush` | `(events: AutoFlushEvent[]): this` | Register one process handler per event that flushes before exit. Signals are flushed + re-raised; `beforeExit` is flushed in place. Idempotent — replaces previous handlers. |
| `disableAutoFlush` | `(): this` | Remove every handler installed by `enableAutoFlush`. Safe with none registered. |
| `setMinLevel` | `(level: LogLevel \| undefined): this` | Drop entries below `level` before fan-out. `undefined` clears. |
| `getMinLevel` | `(): LogLevel \| undefined` | Read the active minimum severity. |
| `setRedact` | `(config: RedactConfig \| undefined): this` | Set the logger-wide redaction floor (applied once before fan-out). See [Redaction](../advanced/01-redaction/). |
| `getRedact` | `(): RedactConfig \| undefined` | Read the active redaction floor. |

## Fields

| Field | Type | Description |
| --- | --- | --- |
| `channels` | `LogChannel[]` | The currently registered channel list. |
| `id` | `string` | Unique identifier for this logger instance. |

## Examples

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

// Register channels via the fluent API
log
  .addChannel(new ConsoleLog())
  .addChannel(new FileLog({ storagePath: "./logs", name: "app" }));

// Positional shorthand — (module, action, message, context?)
await log.info("UserService", "login", "User authenticated");

// Full data object — level implied by log.log
await log.log({
  type: "info",
  module: "UserService",
  action: "login",
  message: "User authenticated",
});

// Retrieve a registered channel by name
const file = log.channel("file");

// Drop debug noise globally — fast-path filter
log.setMinLevel("info");

// Strip secrets before any channel sees them
log.setRedact({ paths: ["context.password", "context.*.token"] });

// Time an operation
const end = log.timer("db", "query");
const rows = await db.query(sql);
await end({ rowCount: rows.length });

// Assertion — logs at error when condition is falsy, no-op otherwise
log.assert(user !== null, "auth", "session", "user vanished mid-flight", { sessionId });
```

:::note[No bare callable]
`log` is not a function. `log({ type, module, action, message })` won't compile — use `log.log({...})` for the data-object form, or any level shortcut for the positional form.
:::

## See also

- [Types](./04-types/) — `LoggingData`, `OmittedLoggingData`, `LogLevel`, `AutoFlushEvent`, `RedactConfig`
- [LogChannel](./02-log-channel/) — the base class for custom channels
