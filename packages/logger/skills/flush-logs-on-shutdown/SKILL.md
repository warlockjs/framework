---
name: flush-logs-on-shutdown
description: 'Drain buffered channels before exit — log.flushSync() or log.configure({autoFlushOn: [''SIGINT'', ''SIGTERM'', ''beforeExit'']}) installs handlers that re-raise the signal. Triggers: `log.flushSync`, `autoFlushOn`, `enableAutoFlush`, `disableAutoFlush`, `SIGINT`, `SIGTERM`, `beforeExit`; "drain logs before exit", "wire SIGTERM for container shutdown", "my logs never showed after a crash", "graceful shutdown logging"; typical import `import { log, FileLog } from "@warlock.js/logger"`. Skip: error capture — `@warlock.js/logger/capture-unhandled-errors/SKILL.md`; custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; competing `pino.final`, `winston.end`; native `process.on(''exit'')`.'
---

# Lifecycle — flushing buffered channels before exit

`FileLog` and `JSONFileLog` buffer entries in memory. A process that exits without draining loses the buffer.

## The easy way — `autoFlushOn`

Tell the logger which process events should trigger a flush. It installs the handlers for you.

```ts
log.configure({
  channels: [new ConsoleLog(), new FileLog({ chunk: "daily" })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
```

### What each event does

| Event | Behavior |
|---|---|
| `SIGINT` / `SIGTERM` / `SIGHUP` / `SIGBREAK` / `SIGUSR2` | Flush → remove this handler → re-raise the signal so Node's default exit code runs (e.g. 130 for SIGINT). |
| `beforeExit` | Flush in place. Node continues its natural exit. |

### Default recommendation

`["SIGINT", "SIGTERM", "beforeExit"]` covers:
- Local `Ctrl+C` (SIGINT)
- Container orchestrators (`docker stop`, Kubernetes sending SIGTERM)
- Natural exit (Node finished all work)

Add `"SIGHUP"` if you care about terminal disconnects. Add `"SIGUSR2"` if you use nodemon or pm2 restart.

### Idempotency

Calling `enableAutoFlush` twice **replaces** previous handlers — it does not stack. `disableAutoFlush()` removes every handler this logger instance registered; safe to call when nothing is registered.

## The manual way — your own handler

Use this when you need async work (close an HTTP server, drain a queue) **before** flushing:

```ts
async function gracefulShutdown() {
  await httpServer.close();
  await queue.drain();
  log.flushSync();          // still sync — guarantees disk write before exit
  process.exit(0);
}

process.once("SIGINT", gracefulShutdown);
process.once("SIGTERM", gracefulShutdown);
```

**If you go manual for a signal, skip it in `autoFlushOn`** — otherwise both handlers fire and ours re-raises the signal mid-way through your async work.

## What `flushSync()` actually does

```ts
log.flushSync();
// For every registered channel:
//   if (channel.flushSync) channel.flushSync();
```

- Synchronous I/O — blocks the event loop.
- Channels without `flushSync` (e.g. `ConsoleLog` — nothing to flush) are skipped silently.
- Works with and without `groupBy` on `FileLog` / `JSONFileLog`.
- No-op if every channel's buffer is empty.

`ConsoleLog` has no `flushSync` — it writes synchronously on every entry. `FileLog` and `JSONFileLog` both implement it.

## Unhandled errors

If you use [`captureAnyUnhandledRejection()`](@warlock.js/logger/capture-unhandled-errors/SKILL.md), **include `"beforeExit"` in `autoFlushOn`**. Otherwise a crash logs the error into the buffer, then the process exits before the 5-second flush interval fires.

```ts
log.configure({
  channels: [new FileLog({ levels: ["error"] })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});

captureAnyUnhandledRejection();
```

## What NOT to do

- **Don't `await` inside a signal handler you wrote yourself and then call `flushSync`** — if an async step rejects, you skip the flush. Wrap in `try { await x } finally { log.flushSync(); process.exit(1); }`.
- **Don't call `process.exit()` inside `autoFlushOn` handlers** — signal handlers here already re-raise the signal. Forcing an exit breaks exit codes.
- **Don't rely on the 5-second flush interval for shutdown safety.** It's a throughput optimization, not a durability guarantee.
