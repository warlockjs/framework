---
title: "Shutdown & flushing"
description: "Make sure buffered log entries reach disk before the process exits."
sidebar:
  order: 3
  label: "Shutdown & flushing"
---

`FileLog` and `JSONFileLog` buffer entries in memory before writing them to disk. This keeps the logger fast and non-blocking — but it means an ungraceful shutdown can drop the last few entries. This page covers when writes happen, what can be lost, and how to guarantee durability.

## When does a write hit the disk?

For `FileLog` and `JSONFileLog`, every `log()` call adds an entry to an in-memory buffer. A write is triggered when **any** of these hold:

1. The buffer reaches `maxMessagesToWrite` (default **100**).
2. More than 5 seconds have elapsed since the last write — checked both immediately after each `log()` call and by a 5-second background interval.
3. You call `log.flushSync()` explicitly.

The first two are **asynchronous** (Node streams). The third is **synchronous** (`fs.appendFileSync`).

:::tip[ConsoleLog never buffers]
`ConsoleLog` writes every entry to stdout immediately. Nothing on this page applies to it.
:::

## What can be lost?

Anything in the buffer when the process terminates without a synchronous flush:

| Exit path | Buffered entries lost? |
| --- | --- |
| Normal `process.exit()` | **Yes** — unless you called `log.flushSync()` first |
| Uncaught exception without a handler | **Yes** |
| `SIGINT` / `SIGTERM` without a handler | **Yes** |
| OS-level kill (`kill -9`, OOM) | **Yes** — unavoidable |
| `await log.info(...)` then `process.exit()` | **Yes** — `log.info` resolves once the entry is buffered, not written |

The asynchronous 5-second flush provides *eventual* durability while the process is alive. It does not help at shutdown.

## Graceful shutdown — the easy way

Pass `autoFlushOn` to `configure()` and the logger installs the handlers for you:

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.configure({
  channels: [new ConsoleLog(), new FileLog({ chunk: "daily" })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
```

Every buffered channel drains before the process exits. You can also call `log.enableAutoFlush([...])` directly at any point, and `log.disableAutoFlush()` to remove every installed handler. Calling `enableAutoFlush` twice replaces the previous handlers (no stacking).

**What each event does:**

| Event | Behavior |
| --- | --- |
| `SIGINT` / `SIGTERM` / `SIGHUP` / `SIGBREAK` / `SIGUSR2` | Flush, then re-raise the signal so Node's default exit behavior runs (exit code 128 + signal number, same as if you had no handler). |
| `beforeExit` | Flush in place. Node exits on its own afterwards — no re-raise. |

:::tip[Default recommendation]
`["SIGINT", "SIGTERM", "beforeExit"]` covers local `Ctrl+C`, container stop, and natural-exit paths. Add `SIGHUP` if you expect terminal disconnects, or `SIGUSR2` if you use nodemon/pm2 restart.
:::

## Graceful shutdown — the manual way

If you need to run async work before flushing (closing an HTTP server, finishing an outbound batch), register your own handler and call `log.flushSync()` at the end:

```ts title="src/shutdown.ts"
import { log } from "@warlock.js/logger";

async function gracefulShutdown() {
  await httpServer.close();
  log.flushSync();
  process.exit(0);
}

process.once("SIGINT", gracefulShutdown);
process.once("SIGTERM", gracefulShutdown);
```

`flushSync()` is fan-out: it calls `flushSync()` on every registered channel that implements it. `ConsoleLog` has no buffer and is skipped; `FileLog` and `JSONFileLog` each drain to disk. Channels without `flushSync` are ignored silently.

:::caution[Don't mix the two paths for the same signal]
If you register your own `SIGINT` listener, skip `"SIGINT"` in `autoFlushOn` — otherwise both handlers run and the signal is re-raised before your async work completes.
:::

## Shutdown with captured unhandled errors

If you use [`captureAnyUnhandledRejection()`](./02-capturing-unhandled-errors/), include `"beforeExit"` in `autoFlushOn` so the terminal error entry reaches disk before Node tears down:

```ts title="src/index.ts"
import {
  log,
  ConsoleLog,
  FileLog,
  captureAnyUnhandledRejection,
} from "@warlock.js/logger";

log.configure({
  channels: [
    new ConsoleLog(),
    new FileLog({ chunk: "daily", levels: ["error", "warn"] }),
  ],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});

captureAnyUnhandledRejection();
```

Without `"beforeExit"` (or an equivalent manual handler), a crash logs the error into the buffer, then the process exits before the 5-second flush interval fires.

## When flushSync is a no-op

Channels that don't buffer (like `ConsoleLog`) skip the call. If every registered channel is unbuffered, `flushSync()` returns immediately — safe to call unconditionally. Within a `FileLog` / `JSONFileLog`, `flushSync()` is also a no-op when the buffer is empty, so you can schedule it liberally without redundant writes.

## See also

- [Capturing unhandled errors](./02-capturing-unhandled-errors/) — wire unhandled rejections + uncaught exceptions through the logger
- [Custom Channel](../channels/05-custom/) — implement `flushSync` in your own buffered channel
