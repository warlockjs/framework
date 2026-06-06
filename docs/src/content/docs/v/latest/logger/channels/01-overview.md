---
title: "Channels — Overview"
description: "How log fan-out works — the terminal flag, ANSI stripping, and the shared options every channel inherits."
sidebar:
  order: 1
  label: "Overview"
---

A **channel** is a destination for log messages. Every channel receives a `LoggingData` object and decides how to store or display it. You can register multiple channels at once — every log call fans out to all of them. A typical setup sends everything to `ConsoleLog` in development while routing errors to `FileLog` and `JSONFileLog` in production.

## Fan-out

When you call `log.info(...)`, the logger builds one entry and hands it to every registered channel. Each channel receives its own shallow clone of the entry, so one channel can't observe another's mutations.

## The `terminal` flag + ANSI stripping

Every channel declares a `terminal` boolean:

- `terminal: true` — output goes to a terminal; ANSI color codes in the message are **preserved**. `ConsoleLog` sets this.
- `terminal: false` (the default) — before the entry reaches the channel, the logger strips ANSI escape codes from string messages via `clearMessage()`. This keeps log **files** free of color codes. `FileLog` and `JSONFileLog` are non-terminal.

### `clearMessage` utility

The same helper the logger uses internally is exported for your own code:

```ts
import { clearMessage } from "@warlock.js/logger";

const raw = "[32mDeployment succeeded[0m";
const plain = clearMessage(raw);
// → "Deployment succeeded"
```

`clearMessage` accepts any value. Non-string values are returned as-is; only strings containing ANSI escape sequences are modified.

## Shared channel options

Every built-in channel accepts the same base options (`BasicLogConfigurations`) on top of its own. The two you'll reach for most are `levels` and `filter`.

### Filter by level

Pass a `levels` array to restrict which levels the channel handles. All other levels are silently ignored. Omit it (the default) to handle every level.

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.setChannels([
  // Console sees everything
  new ConsoleLog(),

  // This file only collects errors and warnings
  new FileLog({
    storagePath: "./logs",
    name: "errors",
    levels: ["error", "warn"],
  }),
]);
```

Valid `LogLevel` values: `"debug"` | `"info"` | `"warn"` | `"error"` | `"success"` | `"fatal"`.

### Custom filter predicate

For suppression that level filtering can't express, pass a `filter`. It receives the full `LoggingData` and returns `true` to forward the entry or `false` to drop it. It runs after the `levels` check.

```ts
import { ConsoleLog, type LoggingData } from "@warlock.js/logger";

// Drop GET /health noise from the console
new ConsoleLog({
  filter: (data: LoggingData) =>
    !(data.type === "info" &&
      typeof data.message === "string" &&
      data.message.includes("GET /health")),
});

// Suppress all debug output from a noisy third-party module
new ConsoleLog({
  filter: (data) => !(data.type === "debug" && data.module === "socket.io"),
});
```

### Timestamp format

All channels accept a `dateFormat` option controlling how timestamps appear. Tokens follow [Day.js format strings](https://day.js.org/docs/en/display/format).

```ts
import { FileLog } from "@warlock.js/logger";

new FileLog({
  storagePath: "./logs",
  dateFormat: {
    date: "YYYY-MM-DD", // default: "DD-MM-YYYY"
    time: "HH:mm:ss.SSS", // default: "HH:mm:ss"
  },
});
```

A channel can also carry a per-channel `redact` config that adds paths on top of the logger-wide floor — see [Redaction](../advanced/01-redaction/).

## Built-in channels

| Channel | `name` | `terminal` | Output |
| --- | --- | --- | --- |
| [`ConsoleLog`](./02-console/) | `"console"` | `true` | Colorized, icon-prefixed terminal lines |
| [`FileLog`](./03-file/) | `"file"` | `false` | Plain-text `.log` files with rotation + chunking |
| [`JSONFileLog`](./04-json-file/) | `"fileJson"` | `false` | Structured `.json` files for aggregators |
| [`SentryLog`](./06-sentry/) | `"sentry"` | `false` | Sentry events + breadcrumbs (needs the optional `@sentry/node` peer) |

Need a different destination — Slack, a database, an HTTP endpoint? Write a [Custom Channel](./05-custom/).

## Channel initialization

Channels initialize lazily: the constructor schedules an `init()` call on the next tick (`setTimeout(0)`) and marks the channel ready once it resolves. For the built-in channels this is invisible. It matters when you write a custom channel that needs async setup (a socket, a DB connection) — see [Custom Channel](./05-custom/).
