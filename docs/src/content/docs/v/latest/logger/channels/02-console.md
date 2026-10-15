---
title: "Console Channel"
description: "ConsoleLog — colorized, icon-prefixed terminal output with optional context rendering."
sidebar:
  order: 2
  label: "Console"
---

`ConsoleLog` writes colorized, icon-prefixed lines to the terminal. No external dependencies, no configuration required to start.

```ts
import { ConsoleLog } from "@warlock.js/logger";

const channel = new ConsoleLog();
```

It sets `terminal: true`, so ANSI color codes in your messages are preserved (unlike the file channels, which strip them).

## Terminal output

Each line follows this format:

```
{icon} {level} ({time}) [{module}] [{action}] {message}
```

The console shows a **time-only** timestamp (`HH:mm:ss.SSS`) — within a dev session the date rarely changes, so the full ISO date is dropped here. The persistent channels (`FileLog` / `JSONFileLog`) keep the full ISO timestamp.

Real output:

```
⚙ debug (10:22:00.000) [auth] [hashPassword] Hashing started
ℹ info (10:22:01.482) [users] [register] New user created
⚠ warn (10:22:02.300) [queue] [process] Retry limit approaching
✗ error (10:22:03.111) [payments] [charge] Card declined
✓ success (10:22:03.890) [email] [send] Welcome email delivered
```

**Prefix by level** — each line is prefixed with the level's icon and name. The name is padded to a fixed width so the timestamp, module, and action columns line up vertically across a stream of logs:

| Level | Prefix |
| --- | --- |
| `debug` | ⚙ debug |
| `info` | ℹ info |
| `warn` | ⚠ warn |
| `error` | ✗ error |
| `success` | ✓ success |
| `fatal` | ☠ fatal — white on a bright-red **background badge** (deliberately louder than `error` so a fatal entry can't be missed) |

**Colors by part**

| Part | Color |
| --- | --- |
| Timestamp `(…)` | Gray (dimmed, so the message stands out) |
| Module `[…]` | Cyan |
| Action `[…]` | Magenta |
| Message — `debug` | Magenta bright |
| Message — `info` | Blue bright |
| Message — `warn` | Yellow bright |
| Message — `error` | Red bright |
| Message — `success` | Green bright |
| Message — `fatal` | Red bright + bold |

:::tip[Object messages]
If `message` is an object, `ConsoleLog` issues a second `console.log` call with the raw object on its own line, so the Node.js inspector (or browser DevTools) can expand it interactively.
:::

## Showing context

By default `ConsoleLog` discards the `context` payload — the file/JSON channels still record it, but the terminal stays uncluttered. Set `showContext: true` to render the context object on a second line, pretty-printed with `util.inspect`:

```ts
import { ConsoleLog, log } from "@warlock.js/logger";

log.addChannel(new ConsoleLog({ showContext: true }));

log.info("payments", "charge", "card declined", {
  userId: 42,
  amount: 1999,
});
// ℹ info (…) [payments] [charge] card declined
//   ↳ { userId: 42, amount: 1999 }
```

`contextDepth` (default `4`) clamps how deep `util.inspect` recurses into nested objects — useful when one context field is a giant payload you don't want sprawling across the terminal:

```ts
new ConsoleLog({
  showContext: true,
  contextDepth: 1, // collapses nested objects to [Object]
});
```

:::note[Dev vs production]
`showContext` is off by default. Persistent channels (`FileLog`, `JSONFileLog`) always retain context regardless of this flag — they just don't surface it in the terminal. A typical setup keeps `showContext: true` in development and the default in production.
:::

## Filtering

`ConsoleLog` accepts the shared `levels` array and `filter` predicate (see [Channels Overview](./01-overview/)). A common pattern is keeping the terminal focused on the subsystem you're working on:

```ts
import { ConsoleLog } from "@warlock.js/logger";

// Only show auth-related messages during local development
new ConsoleLog({
  filter: (data) => data.module === "auth",
});

// Show everything except background workers
new ConsoleLog({
  filter: (data) => !["queue", "scheduler"].includes(data.module),
});

// Errors always pass through, info only for payments
new ConsoleLog({
  filter: (data) => data.type === "error" || data.module === "payments",
});
```

The full option shape is [`ConsoleLogConfig`](../reference/03-channel-configurations/) — the shared options plus `showContext` / `contextDepth`.
