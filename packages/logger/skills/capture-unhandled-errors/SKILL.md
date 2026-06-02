---
name: capture-unhandled-errors
description: 'captureAnyUnhandledRejection() installs process.on(''unhandledRejection'') + (''uncaughtException'') listeners routing failures through log.error(''app'', ...). Triggers: `captureAnyUnhandledRejection`, `unhandledRejection`, `uncaughtException`, `log.error`; "log unhandled promise rejections", "catch uncaught exceptions to a file", "record crashes before exit", "global error handler with logger"; typical import `import { captureAnyUnhandledRejection, log } from "@warlock.js/logger"`. Skip: flushing — `@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`; filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; competing `Sentry.init`, `@sentry/node`; native `process.on(''unhandledRejection'')`.'
---

# Error capture — routing Node's unhandled errors through the logger

`captureAnyUnhandledRejection()` installs two process-level listeners so crashes are logged (not silently swallowed) before Node exits.

## What it does

```ts
import { captureAnyUnhandledRejection } from "@warlock.js/logger";

captureAnyUnhandledRejection();
```

Registers:
- `process.on("unhandledRejection", reason => log.error("app", "unhandledRejection", reason))`
- `process.on("uncaughtException", error => log.error("app", "uncaughtException", error))`

Nothing else — the failure goes through `log.error` only, so it lands in your configured channels rather than bypassing them with a raw `console.log`.

## When to call it

**Once**, at startup, **after** channels are registered. Typical place: immediately after your `log.configure({...})` call.

```ts title="src/index.ts"
import {
  log,
  ConsoleLog,
  FileLog,
  captureAnyUnhandledRejection,
} from "@warlock.js/logger";

log.configure({
  channels: [new ConsoleLog(), new FileLog({ levels: ["error"] })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],   // ← important; see below
});

captureAnyUnhandledRejection();
```

## Pair with `autoFlushOn: ["beforeExit"]`

Without a flush on exit, here's what happens on a crash:

1. Promise rejection fires → `log.error(...)` queues the error into `FileLog`'s buffer.
2. Node exits.
3. Buffer is never flushed. **The error that killed your app is lost.**

Including `"beforeExit"` in `autoFlushOn` closes the gap. Node fires `beforeExit` after the rejection handler resolves, the logger flushes, then Node exits. See [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md).

## Idempotency — don't call it twice

Calling `captureAnyUnhandledRejection()` a second time registers a second pair of listeners. Your next rejection gets logged twice. There's no dedup; just call it once.

## What it does **not** do

- **Does not swallow errors.** Node still exits after `uncaughtException` (this is the safe behavior — state is undefined). The logger just ensures the error is recorded first.
- **Does not install Node's `--unhandled-rejections` policy.** That's a Node flag; set it in your launch script if you want strict mode.
- **Does not hook `SIGTERM` / `SIGINT`** — use `enableAutoFlush` for signal flushes.
- **Does not filter.** Every rejection/exception is logged at `error` level with `module: "app"`. Filter per-channel if some noise slips in.

## Checking an error was captured in tests

Don't mock `process.on` — use a capturing channel and emit the listener directly:

```ts
import { log, captureAnyUnhandledRejection, LogChannel } from "@warlock.js/logger";
import type { LoggingData } from "@warlock.js/logger";

class Capture extends LogChannel {
  public name = "capture";
  public received: LoggingData[] = [];
  public log(data: LoggingData) { this.received.push({ ...data }); }
}

it("routes unhandled rejections to the logger", async () => {
  const capture = new Capture();
  const originalChannels = log.channels;
  log.channels = [capture];

  captureAnyUnhandledRejection();
  process.emit("unhandledRejection", new Error("boom"), Promise.resolve());

  await new Promise((r) => setTimeout(r, 0));

  expect(capture.received[0]!.module).toBe("app");
  expect(capture.received[0]!.action).toBe("unhandledRejection");

  log.channels = originalChannels;
});
```

## Module + action the capture uses

Both listeners log with:
- `module: "app"`
- `action: "unhandledRejection"` or `action: "uncaughtException"`
- `message`: the rejection reason / exception (keep it as the raw `Error` object — file channels capture the stack).

If you want these routed to a specific file, filter on `data.module === "app"`. See [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md).
