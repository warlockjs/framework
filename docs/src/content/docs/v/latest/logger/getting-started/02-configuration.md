---
title: "Configuration"
description: "The four logger-level knobs — channels, autoFlushOn, minLevel, redact — and how they compose."
sidebar:
  order: 2
  label: "Configuration"
---

The `log` singleton starts with zero channels. Configuration is how you attach channels, set a severity floor, wire shutdown flushing, and set a redaction floor — all at the logger level. Per-channel options (level filters, timestamp format, custom filters) are covered on the [Channels Overview](../channels/01-overview/).

## Adding channels

Three methods attach channels to any `Logger` instance. Pick based on how much control you need.

### `addChannel(channel)` — append one

Adds a single channel without touching the ones already registered. Safe to call multiple times.

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.addChannel(new ConsoleLog());
log.addChannel(new FileLog({ storagePath: "./logs" }));
```

### `setChannels(channels[])` — replace all

Replaces every existing channel with the supplied array. Use it for a clean slate — for example, swapping channels per environment.

```ts
import { log, FileLog } from "@warlock.js/logger";

log.setChannels([
  new FileLog({ storagePath: "./logs", chunk: "daily" }),
]);
```

### `configure({ channels, autoFlushOn, minLevel, redact })` — object-style setup

Accepts an options object. Every field is optional — pass only what you want to change.

| Field | Effect |
| --- | --- |
| `channels` | Replaces the channel list (same as `setChannels`). |
| `autoFlushOn` | Installs process-level auto-flush handlers — see [Shutdown & flushing](../advanced/03-shutdown-and-flushing/). |
| `minLevel` | Sets the logger-wide severity floor. Entries below this rank are dropped before fan-out. |
| `redact` | Sets the logger-wide redaction floor — see [Redaction](../advanced/01-redaction/). |

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.configure({
  channels: [new ConsoleLog(), new FileLog({ chunk: "daily" })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
  minLevel: "info",
  redact: {
    paths: ["context.password", "context.*.token"],
  },
});
```

## Environment-based setup

Build the channel list once at startup, keyed on `process.env.NODE_ENV`, then apply it with a single `setChannels`. Put it in a dedicated file and import it early in your entry point.

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog, type LogChannel } from "@warlock.js/logger";

const channels: LogChannel[] = [];

if (process.env.NODE_ENV === "production") {
  channels.push(
    new FileLog({
      storagePath: process.cwd() + "/storage/logs",
      chunk: "daily",
      rotate: true,
      maxFileSize: 10 * 1024 * 1024, // 10 MB
    }),
  );
} else if (process.env.NODE_ENV !== "test") {
  // development and everything else — test stays silent (empty array)
  channels.push(new ConsoleLog());
}

log.setChannels(channels);
```

```ts title="src/index.ts"
import "./logger"; // configures the singleton as a side effect

import { log } from "@warlock.js/logger";

log.info("app", "boot", "App started");
```

`log` is a singleton — `import "./logger"` runs the configuration once as a side effect, and every other file imports `log` straight from `@warlock.js/logger`. No need to re-export it.

:::tip
Keep channel construction inside the environment branch so file handles and paths are only created when they're actually needed.
:::

## Logger-wide minimum level

The cheapest way to silence low-severity noise is the logger-wide `minLevel`. Entries below the rank are dropped **before** fan-out — no channel sees them, no filter runs, no allocation happens.

```ts
import { log } from "@warlock.js/logger";

// at startup
log.configure({ minLevel: "info" });

// or at runtime
log.setMinLevel("warn");

// clear it
log.setMinLevel(undefined);
```

Severity ranking: `debug < info ≈ success < warn < error < fatal`. Setting `minLevel: "warn"` drops `debug`, `info`, and `success`. The `success` level shares `info` severity — it's treated as informational, not as a warning. `fatal` is strictly above `error`, so `minLevel: "fatal"` admits only fatal entries.

:::tip[Per-channel filters still apply]
`minLevel` is the global floor. Each channel's own `levels` array and `filter` predicate run on top of it — useful when one destination needs to be louder or quieter than the global default. See [Channels Overview](../channels/01-overview/).
:::

## Retrieving a channel by name

`log.channel(name)` returns a previously registered channel instance, or `undefined` when no channel with that name is found.

| Channel | `name` |
| --- | --- |
| `ConsoleLog` | `"console"` |
| `FileLog` | `"file"` |
| `JSONFileLog` | `"fileJson"` |

```ts
import { log } from "@warlock.js/logger";

const consoleChannel = log.channel("console"); // ConsoleLog | undefined
const fileChannel = log.channel("file");       // FileLog | undefined
```

:::note
`log.channel` looks up by the channel's `name` property. If you register multiple file channels, only the last one registered under that name is reachable this way — keep a reference to the instance if you need several named file channels.
:::

## Inside a Warlock app

On `@warlock.js/core` you don't call `log.setChannels` directly. You export a `LogConfigurations` object from `src/config/log.ts` and the framework wires it into the singleton on boot, keyed on the current environment:

```ts title="src/config/log.ts"
import { type LogConfigurations } from "@warlock.js/core";
import { ConsoleLog, JSONFileLog } from "@warlock.js/logger";

const consoleLog = new ConsoleLog();

const logConfigurations: LogConfigurations = {
  enabled: true,
  development: {
    channels: [consoleLog],
  },
  test: {
    channels: [consoleLog],
  },
  production: {
    channels: [
      consoleLog,
      new JSONFileLog({ storagePath: process.cwd() + "/storage/logs", chunk: "daily" }),
    ],
  },
};

export default logConfigurations;
```

The standalone API above is what you reach for outside Warlock, or for runtime overrides on top of the configuration file.

## Next

Continue to [Your first log](./03-your-first-log/) for the call-site API — levels, structured context, errors, and the timer/assert helpers.

Working a specific task? See [Silence noisy logs per environment](../recipes/04-silence-noisy-logs/) for `minLevel` / `levels` / `filter` in combination.
