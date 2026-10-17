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
          chunk: "daily", // one file per calendar day → 2024-03-15.log
          rotate: true, // roll the file over once it gets too big
          maxFileSize: 10 * 1024 * 1024, // 10 MB per file before rotation
          retention: { maxFiles: 30, maxAgeDays: 30 }, // prune old days and archives
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

- **`chunk: "daily"`** names the file by ISO date, so you get `2024-03-15.log`, `2024-03-16.log`, … (sorted by name = sorted by day) instead of one ever-growing `app.log`. Use `"hourly"` for very high volume, `"single"` (the default) for a single file, or `fileName: "app-{YYYY}-{MM}-{DD}"` for your own pattern.
- **`rotate: true`** (the default) checks the active file's size before each write and, once it passes `maxFileSize`, renames it aside (`2024-03-15-2024-03-15-1710494523000.log`) and starts a fresh one.
- **`retention`** removes this channel's old files — on boot and whenever a new file starts — keeping the 30 newest and none older than 30 days. Only files matching the channel's name pattern are touched; failures go to `onChannelError`, never to the call site.
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
With `chunk: "daily"` (or `"hourly"`) and no `fileName`, the file is named by the date, **not** by the `name` option — so two daily channels in the same `storagePath` would write to the _same_ file. Give each channel its own `storagePath` directory (as above), or its own pattern such as `fileName: "errors-{YYYY}-{MM}-{DD}"`.
:::

:::caution[Rotation renames, retention deletes]
`rotate` rolls the current file aside when it exceeds `maxFileSize`; without `retention`, nothing prunes the archives and they accumulate on a long-lived host. Set `retention` (as above) or use an external tool such as logrotate.
:::

## See also

- [File Channel](../channels/03-file/) — every `FileLog` option in detail
- [Shutdown & flushing](../advanced/03-shutdown-and-flushing/) — why the buffer needs draining and how `autoFlushOn` does it
- [JSON File Channel](../channels/04-json-file/) — swap `FileLog` for `JSONFileLog` when a log aggregator reads the files
