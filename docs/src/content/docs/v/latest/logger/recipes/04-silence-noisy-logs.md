---
title: "Silence noisy logs per environment"
description: "Drop debug noise in production, mute a chatty module, and keep the dev terminal focused — minLevel, levels, and filter."
sidebar:
  order: 4
  label: "Silence noisy logs"
---

Three different "too much noise" problems, three different tools:

| Problem | Reach for |
| --- | --- |
| "Drop everything below `info` in prod" | logger-wide `minLevel` |
| "This one file should only collect errors" | per-channel `levels` |
| "Mute health-check / third-party chatter" | per-channel `filter` |

They stack — `minLevel` runs first (before any channel), then each channel applies its own `levels` and `filter`.

## Drop low-severity noise everywhere — `minLevel`

The cheapest control. Entries below the floor are dropped **before fan-out**, so no channel sees them and nothing is allocated:

```ts title="src/logger.ts"
import { log } from "@warlock.js/logger";

log.configure({
  // debug + everything below `info` is dropped globally
  minLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
});

// or flip it at runtime
log.setMinLevel("warn");
log.setMinLevel(undefined); // clear — accept all levels again
```

Severity order is `debug < info ≈ success < warn < error < fatal`. `minLevel: "warn"` drops `debug`, `info`, **and** `success` (success shares info's rank). `fatal` is strictly above `error`, so it's never dropped by `minLevel` short of disabling the floor. This is the right tool for "production should be quieter than dev."

## Restrict a single channel — `levels`

When the *channel* should only ever handle certain levels — e.g. a file that's just an error log — use its `levels` whitelist. Other channels are unaffected:

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.setChannels([
  new ConsoleLog(), // sees every level
  new FileLog({
    name: "errors", // → errors.log (name applies because chunk is "single")
    levels: ["error", "warn"], // this file only grows with errors + warnings
  }),
]);
```

Omitting `levels` (or passing `[]`) means "allow all six." (With `chunk: "daily"` the file is named by date, not by `name` — see the [rotating-file recipe](./01-rotating-file-in-production/) for the gotcha.)

## Mute a chatty module — `filter`

For suppression that levels can't express — a specific module, a message pattern, a health-check route — pass a `filter` predicate. It receives the full `LoggingData` and returns `true` to keep the entry, `false` to drop it. It runs **after** the `levels` check:

```ts
import { ConsoleLog, type LoggingData } from "@warlock.js/logger";

// Drop GET /health spam from the dev terminal
new ConsoleLog({
  filter: (data: LoggingData) =>
    !(data.type === "info" &&
      typeof data.message === "string" &&
      data.message.includes("GET /health")),
});

// Silence all debug output from a noisy third-party module
new ConsoleLog({
  filter: (data) => !(data.type === "debug" && data.module === "socket.io"),
});
```

The predicate is **synchronous** — it runs on every entry that passes the level check, so keep it cheap and don't `await` inside it.

## Keep the dev terminal focused on what you're working on

A handy inverse — surface only the subsystem you're actively debugging:

```ts
new ConsoleLog({
  filter: (data) => data.module === "auth" || data.type === "error",
});
// You see auth logs + every error, nothing else.
```

## Putting it together per environment

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

const isProduction = process.env.NODE_ENV === "production";

log.configure({
  channels: isProduction
    ? [
        new FileLog({ storagePath: "./storage/logs", chunk: "daily" }),
        // Own directory — two daily files in one directory would collide
        // (daily chunking names the file by date, ignoring `name`).
        new FileLog({ storagePath: "./storage/logs/errors", levels: ["error", "warn"], chunk: "daily" }),
      ]
    : [new ConsoleLog({ showContext: true })],
  minLevel: isProduction ? "info" : "debug",
});
```

Dev sees everything (with context expanded); prod drops `debug`/below globally and keeps a separate error file.

:::note[There's no global filter predicate]
`minLevel` is the only logger-wide drop control. There's no `log.setGlobalFilter()` — `filter` is per channel by design. To apply the same predicate everywhere, pass it to each channel constructor (or write a small factory that does).
:::

## See also

- [Configuration](../getting-started/02-configuration/) — `minLevel` and the environment-branch pattern
- [Channels Overview](../channels/01-overview/) — the `levels` whitelist and `filter` predicate in depth
