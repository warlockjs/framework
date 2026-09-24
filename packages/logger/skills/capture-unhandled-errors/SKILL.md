---
name: capture-unhandled-errors
description: 'captureAnyUnhandledRejection() installs process.on(''unhandledRejection'') → log.error and process.on(''uncaughtException'') → log.fatal + process.exit(1) so process-level failures land in your channels and a fatal crash is never silently swallowed into exit 0. Triggers: `captureAnyUnhandledRejection`, `exitOnUncaughtException`, `unhandledRejection`, `uncaughtException`, `log.error`, `log.fatal`; "log unhandled promise rejections", "catch uncaught exceptions to a file", "record crashes before exit", "server exits 0 with no error", "silent exit / production server stopped", "global error handler with logger"; typical import `import { captureAnyUnhandledRejection, log } from "@warlock.js/logger"`. Skip: flushing — `@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`; filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; competing `Sentry.init`, `@sentry/node`; native `process.on(''unhandledRejection'')`.'
---

# Error capture — routing Node's unhandled errors through the logger

`captureAnyUnhandledRejection()` installs two process-level listeners so crashes are logged — and, for an `uncaughtException`, made loud and terminal — instead of being silently swallowed.

## What it does

```ts
import { captureAnyUnhandledRejection } from "@warlock.js/logger";

captureAnyUnhandledRejection();
```

Registers:
- `process.on("unhandledRejection", reason => log.error("app", "unhandledRejection", reason))` — logged; the process is kept alive.
- `process.on("uncaughtException", error => log.fatal("app", "uncaughtException", error))` — logged, then `process.exit(1)` (by default).

The split is intentional: an `uncaughtException` leaves the process in an undefined state, so it's semantically `fatal` and takes the process down. An `unhandledRejection` is a failure but not always process-ending (depends on Node's `--unhandled-rejections` policy and your app's recovery), so it stays at `error` and never exits. This makes "page on fatal" alerting clean — only true crashes ring the pager.

## Why it exits (and why that matters)

Registering *any* `uncaughtException` listener **suppresses** Node's default "print the stack + exit non-zero." A listener that only logs therefore turns an unrecoverable crash into a silent `exit 0` — which is exactly how a config file that throws at boot can look like "the server started, then just stopped," with no error printed. So the handler restores the contract:

- **Exits non-zero** after logging (`process.exit(1)`), following a best-effort, time-bounded `log.flush()` so buffered `FileLog` / `SentryLog` entries drain first. Opt out with `captureAnyUnhandledRejection({ exitOnUncaughtException: false })` where the process is expected to recover on its own (a dev server reloading via HMR).
- **Falls back to `console.error`** when no terminal channel is configured yet — the early-boot window, before `log.configure(...)`, where `log.fatal` has nowhere visible to go. When a `ConsoleLog` is present it already prints the entry, so the fallback is skipped (no double output).

> The framework wires this for you in `bootstrap()` as `captureAnyUnhandledRejection({ exitOnUncaughtException: Application.isProduction })` — production crashes loudly and non-zero, the dev server logs-and-continues so HMR can recover.

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

## Flushing on the crash path

The `uncaughtException` handler runs a best-effort, time-bounded `log.flush()` **before** its own `process.exit(1)`, so buffered `FileLog` / `SentryLog` entries drain even though `process.exit()` skips `beforeExit`. You don't need `autoFlushOn: ["beforeExit"]` for the fatal entry to survive — the handler already drains.

`"beforeExit"` in `autoFlushOn` is still worth setting for the *other* exit routes (a natural drain when the event loop empties on its own). For signal-driven shutdown (`SIGINT` / `SIGTERM`), include those signals in `autoFlushOn`. See [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md).

## Idempotency — don't call it twice

Calling `captureAnyUnhandledRejection()` a second time registers a second pair of listeners. Your next rejection gets logged twice. There's no dedup; just call it once.

## What it does **not** do

- **Does not swallow a fatal error.** After an `uncaughtException` it records the error, then exits non-zero itself — restoring Node's own default, which merely registering the listener would otherwise suppress. Pass `{ exitOnUncaughtException: false }` only when the process is meant to survive (e.g. HMR).
- **Does not exit on an `unhandledRejection`.** That path only logs (at `error`); the process keeps running. Set Node's `--unhandled-rejections=throw` if you want a rejection to escalate to an `uncaughtException`.
- **Does not install Node's `--unhandled-rejections` policy.** That's a Node flag; set it in your launch script if you want strict mode.
- **Does not hook `SIGTERM` / `SIGINT`** — use `enableAutoFlush` for signal flushes.
- **Does not filter.** Every rejection is logged at `error` and every uncaught exception at `fatal`, both with `module: "app"`. Filter per-channel if some noise slips in.

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

Testing the **`uncaughtException`** path additionally trips `process.exit(1)`, so stub it (`vi.spyOn(process, "exit").mockImplementation(() => undefined as never)`) or pass `{ exitOnUncaughtException: false }` — otherwise the emitted exception tears the test runner down. See [`@warlock.js/logger/test-logging-code/SKILL.md`](@warlock.js/logger/test-logging-code/SKILL.md).

## Module + action the capture uses

Both listeners log with:
- `module: "app"`
- `action: "unhandledRejection"` (at `error`) or `action: "uncaughtException"` (at `fatal`)
- `message`: the rejection reason / exception (keep it as the raw `Error` object — file channels capture the stack).

If you want these routed to a specific file, filter on `data.module === "app"`. See [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md).
