---
name: test-logging-code
description: 'Test code that touches the logger — silence globally via log.setChannels([]) in setupFiles, assert specific log lines via a capturing LogChannel subclass (prefer it over vi.spyOn — it asserts on delivered entries, not just method calls, and isolates the shared singleton cleanly). Triggers: `log.setChannels`, `LogChannel`, `LoggingData`, `Logger`, `log.channels`; "silence logger in vitest", "assert a log line was emitted", "capture log output in tests", "test code that logs"; typical import `import { log, Logger, LogChannel, type LoggingData } from "@warlock.js/logger"`. Skip: custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; competing `vi.spyOn(console)`, `jest.spyOn`.'
---

# Testing — code that logs, and asserting on log output

Two scenarios: **silencing the logger during tests** (most common) and **asserting that a specific log line was emitted**.

## Silence the logger during tests

Clear every channel once, globally. No output, no file handles, no noise.

```ts title="src/setupTests.ts"
import { log } from "@warlock.js/logger";

log.setChannels([]);
```

Wire it in Vitest:

```ts title="vitest.config.ts"
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["src/setupTests.ts"],
  },
});
```

## Assert on log output — use a capturing channel

Don't spy on `console.log` and don't mock `log.info` — assert on what a channel actually received instead (see "Why not spy on `log.info`?" below). The cleanest pattern is a tiny channel that records what it sees:

```ts
import { LogChannel } from "@warlock.js/logger";
import type { LoggingData } from "@warlock.js/logger";

class CapturingChannel extends LogChannel {
  public name = "capture";
  public terminal = false;
  public received: LoggingData[] = [];
  public log(data: LoggingData) { this.received.push({ ...data }); }
}
```

### Test against the singleton

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { log } from "@warlock.js/logger";
import { createUser } from "./users";

describe("createUser", () => {
  let capture: CapturingChannel;
  let originalChannels: typeof log.channels;

  beforeEach(() => {
    capture = new CapturingChannel();
    originalChannels = log.channels;
    log.channels = [capture];
  });

  afterEach(() => {
    log.channels = originalChannels;
  });

  it("logs a success entry when the user is created", async () => {
    await createUser({ email: "a@b.com" });

    expect(capture.received).toContainEqual(
      expect.objectContaining({
        type: "success",
        module: "users",
        action: "create",
      }),
    );
  });
});
```

### Test an isolated logger (avoid touching the singleton)

If the code under test accepts a logger via injection, create one per test:

```ts
import { Logger } from "@warlock.js/logger";

const testLogger = new Logger();
const capture = new CapturingChannel();
testLogger.addChannel(capture);

await createUser({ email: "a@b.com" }, testLogger);

expect(capture.received[0]!.type).toBe("success");
```

No cleanup needed — the local `Logger` is garbage-collected.

## Why not spy on `log.info`?

`log` is a plain `Logger` instance (`export const log = new Logger()`) and every level method lives on the prototype, so `vi.spyOn(log, "info")` *does* technically work. Prefer the capturing channel anyway:

- A spy on `log.info` proves the method was **called**, not that an entry was **delivered** — it skips the whole pipeline (`minLevel` floor, redaction, per-channel `levels` / `filter`). A capturing channel asserts on the entry your code under test actually produced after all of that ran.
- The `log` singleton is shared global state. A spy you forget to `mockRestore()` leaks into the next test; swapping `log.channels` and restoring it in `afterEach` is the same amount of code and isolates cleanly.
- Code that logs through `log.error(...)` and the bare object form `log.log({ type, ... })` both land in channels, but only the level shortcut goes through `log.info` — a channel catches both.

So capture through a channel as shown above; reach for a method spy only when you specifically want to assert "this exact shortcut was invoked".

## Testing a custom channel

Write specs against the channel directly; don't route through `Logger`:

```ts
import { describe, it, expect, vi } from "vitest";
import { SlackLog } from "./slack-log";

describe("SlackLog", () => {
  it("skips non-error levels", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

    const channel = new SlackLog({ webhookUrl: "https://test", levels: ["error"] });
    await channel.log({ type: "info", module: "x", action: "y", message: "z" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

## Testing `FileLog` and `JSONFileLog`

Use real temp directories — it's the only way to exercise file IO, rotation, chunking, and JSON I/O with fidelity:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";

function tempDir() {
  const dir = path.join(os.tmpdir(), "logger-test", randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

Clean up in `afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))`.

## Waiting for async init

`LogChannel.init()` runs inside a `setTimeout(0)`. Before asserting on post-init behavior, yield once:

```ts
const channel = new FileLog({ storagePath: tempDir() });
await new Promise((r) => setTimeout(r, 10));
// Now `channel.isInitialized` is true and it's safe to call `channel.log(...)` for real I/O.
```

## Testing `captureAnyUnhandledRejection`

Don't actually throw unhandled rejections in tests — emit the listener directly:

```ts
captureAnyUnhandledRejection();
process.emit("unhandledRejection", new Error("test"), Promise.resolve());
```

The `uncaughtException` path additionally calls `process.exit(1)`, so stub it (or pass `{ exitOnUncaughtException: false }`) before emitting — otherwise the emitted exception tears the test runner down:

```ts
vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
captureAnyUnhandledRejection();
process.emit("uncaughtException", new Error("test"), "uncaughtException");
```

See [`@warlock.js/logger/capture-unhandled-errors/SKILL.md`](@warlock.js/logger/capture-unhandled-errors/SKILL.md) for a full example.
