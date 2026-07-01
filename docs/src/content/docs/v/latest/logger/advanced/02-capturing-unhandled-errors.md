---
title: "Capturing unhandled errors"
description: "Route unhandledRejection + uncaughtException through the logger before the process dies."
sidebar:
  order: 2
  label: "Unhandled errors"
---

`captureAnyUnhandledRejection()` is a one-call helper that routes Node's two top-level error events through the logger. Call it once during startup, after your channels are registered.

## What it does

Calling the helper attaches two process-level listeners:

| Node event | Forwarded to | Then | Module / Action |
| --- | --- | --- | --- |
| `unhandledRejection` | `log.error(...)` | process kept alive | `"app"` / `"unhandledRejection"` |
| `uncaughtException` | `log.fatal(...)` | `process.exit(1)` (default) | `"app"` / `"uncaughtException"` |

The split is intentional: an `uncaughtException` leaves the process in an undefined state, so it's semantically `fatal` and the helper takes the process down with a non-zero exit. An `unhandledRejection` is a failure but not necessarily process-ending (depends on Node's `--unhandled-rejections` policy and your app's recovery), so it stays at `error` and never exits. This makes "page only on fatal" alerting clean.

Registering *any* `uncaughtException` listener suppresses Node's default "print stack + exit non-zero," so a listener that only logged would turn a fatal crash into a silent `exit 0`. The helper restores the exit (after a best-effort `log.flush()`), and when no terminal channel is configured yet — the early-boot window before `log.setChannels(...)` — it also writes the stack to `console.error` so a boot-time throw is never invisible. Opt out of the exit with `captureAnyUnhandledRejection({ exitOnUncaughtException: false })`.

The original error is passed as the `message` argument, so `FileLog` captures the full stack trace and `JSONFileLog` stores the stack as a `string[]`.

```ts title="src/index.ts"
import {
  log,
  ConsoleLog,
  FileLog,
  captureAnyUnhandledRejection,
} from "@warlock.js/logger";

log.setChannels([
  new ConsoleLog(),
  new FileLog({ chunk: "daily" }),
]);

captureAnyUnhandledRejection();
```

## Flushing the fatal entry

The `uncaughtException` handler already runs a best-effort, time-bounded `log.flush()` **before** its own `process.exit(1)`, so a buffered fatal entry drains without extra wiring — and because `process.exit()` skips `beforeExit`, a `beforeExit` flush would not fire on this path anyway. Reserve `autoFlushOn` / `flushSync` for signal-driven or natural shutdowns — see [Shutdown & flushing](./03-shutdown-and-flushing/).

## Behavior & gotchas

- **Call order matters.** Register your channels *before* calling `captureAnyUnhandledRejection()`. Listeners forward to the current singleton; if no terminal channel is registered yet, a captured `uncaughtException` prints to `console.error` as a fallback.
- **Not idempotent.** Each call registers *another* pair of process listeners. Calling it twice double-logs every captured error. Call it exactly once.
- **Exits on `uncaughtException`.** The helper restores Node's default non-zero exit that registering the listener would otherwise suppress — so a fatal crash is never silently swallowed. Pass `{ exitOnUncaughtException: false }` to keep the process alive (e.g. a dev server recovering via HMR); the framework passes `Application.isProduction` for you.
- **Safe when the logger has no channels.** The forwarded log call no-ops, and the `console.error` fallback still surfaces the stack; no error is raised.
- **Console fallback is fatal-only.** The `uncaughtException` handler writes to `console.error` *only* when no terminal channel is configured (so a boot-time crash is visible); it isn't doubled when a `ConsoleLog` is present, and the `unhandledRejection` path never writes to stdout/stderr.

## Rolling your own

If you need different routing (send only `uncaughtException` to the logger, for example), skip the helper and register the listener directly:

```ts
import { log } from "@warlock.js/logger";

process.on("uncaughtException", (error) => {
  log.fatal("app", "uncaughtException", error);
});
```

## See also

- [Shutdown & flushing](./03-shutdown-and-flushing/) — guarantee the terminal error entry reaches disk before the process exits
