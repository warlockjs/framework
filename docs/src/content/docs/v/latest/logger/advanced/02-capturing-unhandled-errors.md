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

| Node event | Forwarded to | Module | Action |
| --- | --- | --- | --- |
| `unhandledRejection` | `log.error(...)` | `"app"` | `"unhandledRejection"` |
| `uncaughtException` | `log.error(...)` | `"app"` | `"uncaughtException"` |

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

## Pair it with `flushSync`

`uncaughtException` means Node is about to terminate. Without a synchronous flush the buffered error entry is lost — see [Shutdown & flushing](./03-shutdown-and-flushing/).

```ts
captureAnyUnhandledRejection();

process.once("beforeExit", () => log.flushSync());
```

## Behavior & gotchas

- **Call order matters.** Register your channels *before* calling `captureAnyUnhandledRejection()`. Listeners forward to the current singleton; there's no late-binding fallback if channels are added afterward.
- **Not idempotent.** Each call registers *another* pair of process listeners. Calling it twice double-logs every captured error. Call it exactly once.
- **Does not prevent exit.** The helper doesn't replace Node's default `uncaughtException` behavior — the process still terminates after the handler runs.
- **Safe when the logger has no channels.** The forwarded call silently no-ops; no error is raised.
- **No raw stdout writes.** The handler routes the failure through `log.error` only — it never bypasses your channels with a stray `console.log`.

## Rolling your own

If you need different routing (send only `uncaughtException` to the logger, for example), skip the helper and register the listener directly:

```ts
import { log } from "@warlock.js/logger";

process.on("uncaughtException", (error) => {
  log.error("app", "uncaughtException", error);
});
```

## See also

- [Shutdown & flushing](./03-shutdown-and-flushing/) — guarantee the terminal error entry reaches disk before the process exits
