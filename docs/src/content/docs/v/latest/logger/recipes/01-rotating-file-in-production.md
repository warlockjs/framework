---
title: "Log to a rotating file in production"
description: "Write durable, size-capped log files on disk that flush on shutdown — the standard production setup."
sidebar:
  order: 1
  label: "Rotating file in prod"
---

You want production logs on disk: one file per day, capped so a single file never grows without bound, and guaranteed to flush the last entries when the container stops. That's three options on `FileLog` plus one `autoFlushOn`.

## The setup

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

const isProduction = process.env.NODE_ENV === "production";

log.configure({
  channels: isProduction
    ? [
        new FileLog({
          storagePath: process.cwd() + "/storage/logs",
          chunk: "daily", // one file per calendar day → 15-03-2024.log
          rotate: true, // roll the file over once it gets too big
          maxFileSize: 10 * 1024 * 1024, // 10 MB per file before rotation
        }),
      ]
    : [new ConsoleLog()],
  // Drain the in-memory buffer before the process exits.
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
```

Import it once, as early as possible:

```ts title="src/index.ts"
import "./logger"; // side-effect: configures the singleton

import { log } from "@warlock.js/logger";

log.info("app", "boot", "Server listening on :3000");
```

## What each piece does

- **`chunk: "daily"`** names the file by date, so you get `15-03-2024.log`, `16-03-2024.log`, … instead of one ever-growing `app.log`. Use `"hourly"` for very high volume, `"single"` (the default) for a single file.
- **`rotate: true`** (the default) checks the active file's size before each write and, once it passes `maxFileSize`, renames it aside (`app-15-03-2024-1710494523000.log`) and starts a fresh one.
- **`maxFileSize`** is in bytes — `10 * 1024 * 1024` is 10 MB, which is also the default.
- **`autoFlushOn`** is the important one. `FileLog` buffers entries in memory (it flushes at 100 entries or every 5 seconds), so a process that exits without draining loses whatever is still buffered. Wiring `SIGINT` / `SIGTERM` / `beforeExit` makes the logger flush on `Ctrl+C`, `docker stop`, and natural exit. See [Shutdown & flushing](../advanced/03-shutdown-and-flushing/).

## Keeping errors in their own file

A common refinement: everything goes to the daily file, **and** errors and warnings get their own dedicated file so on-call doesn't have to grep the firehose.

```ts
log.setChannels([
  new FileLog({ storagePath: "./storage/logs", chunk: "daily" }),
  new FileLog({
    storagePath: "./storage/logs/errors", // ← its own directory
    levels: ["error", "warn"], // only these reach this file
    chunk: "daily",
  }),
]);
```

The `levels` whitelist is per channel — the first file still records everything. See [Channels Overview](../channels/01-overview/) for the filtering model.

:::caution[`chunk: "daily"` ignores `name`]
With `chunk: "daily"` (or `"hourly"`) the file is named by the date, **not** by the `name` option — so two daily channels in the same `storagePath` would write to the *same* file. Give each channel its own `storagePath` directory (as above) to keep them separate. `name` only takes effect with `chunk: "single"`.
:::

:::caution[Rotation renames, it doesn't delete]
`rotate` rolls the current file aside when it exceeds `maxFileSize`, but nothing prunes the rotated archives — on a long-lived host they accumulate. Pair this with an external log-retention tool (logrotate, a cron cleanup, or your platform's log shipper) until built-in retention lands.
:::

## See also

- [File Channel](../channels/03-file/) — every `FileLog` option in detail
- [Shutdown & flushing](../advanced/03-shutdown-and-flushing/) — why the buffer needs draining and how `autoFlushOn` does it
- [JSON File Channel](../channels/04-json-file/) — swap `FileLog` for `JSONFileLog` when a log aggregator reads the files
