---
title: "File Channel"
description: "FileLog — plain-text logs on disk with chunking, rotation, grouping, and buffered writes."
sidebar:
  order: 3
  label: "File"
---

`FileLog` writes plain-text log lines to disk. Entries are buffered in memory and written out whenever the buffer reaches `maxMessagesToWrite` (default `100`), or when more than 5 seconds have elapsed since the last write — whichever comes first. A background interval re-checks the buffer every 5 seconds so low-traffic channels don't sit on stale entries.

```ts
import { FileLog } from "@warlock.js/logger";

const channel = new FileLog({
  storagePath: process.cwd() + "/storage/logs",
  chunk: "daily",
});
```

Because buffered entries live in memory until a flush, drain the buffer on shutdown — see [Shutdown & flushing](../advanced/03-shutdown-and-flushing/).

## File format

Each line follows:

```
[date time] [level] [module][action]: message
```

Real output:

```
[15-03-2024 10:22:01] [info] [users][register]: New user created
[15-03-2024 10:22:03] [error] [payments][charge]: Card declined
```

### Error objects

When the logged `message` is an `Error`, `FileLog` writes the `.message` first, then a `[trace]` marker, then the full `.stack`:

```
[15-03-2024 10:22:03] [error] [payments][charge]: Card declined
[trace]
Error: Card declined
    at chargeCard (/app/src/payments.ts:42:11)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
```

## File naming and chunking

The `chunk` option controls how entries split across files.

| Value | Description | Example filename |
| --- | --- | --- |
| `"single"` | One file for all entries (default) | `app.log` |
| `"daily"` | One file per calendar day | `15-03-2024.log` |
| `"hourly"` | One file per hour | `15-03-2024-10-00-00-am.log` |

```ts
// One file per day — good balance of granularity and file count
new FileLog({ storagePath: "./storage/logs", chunk: "daily" });

// One file per hour — useful for high-volume services
new FileLog({ storagePath: "./storage/logs", chunk: "hourly" });
```

## File rotation

With `rotate: true` (the default), `FileLog` checks the active file size before each write. Once it exceeds `maxFileSize` bytes, the file is renamed with a timestamp suffix and a fresh file is opened:

```
storage/logs/
├── app.log                              ← active file (fresh after rotation)
└── app-15-03-2024-1710494523000.log     ← rotated archive
```

The rotated name is `{name}-{rotateFileName}-{Date.now()}.{extension}`. Control the date portion with the `rotateFileName` Day.js format string.

```ts
new FileLog({
  storagePath: "./storage/logs",
  rotate: true,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  rotateFileName: "DD-MM-YYYY",
});
```

## Grouping into sub-directories

`groupBy` arranges files into a directory hierarchy instead of one flat file. Values map to `LoggingData` fields (`"level"`, `"module"`, `"action"`). **Order determines nesting depth** — the first entry is the top-level directory.

```ts
new FileLog({
  storagePath: "./storage/logs",
  groupBy: ["level", "module"],
});
```

With `["level", "module"]`:

```
storage/logs/
├── error/
│   ├── payments/
│   │   └── app.log
│   └── users/
│       └── app.log
├── info/
│   └── users/
│       └── app.log
└── warn/
    └── queue/
        └── app.log
```

Adding `"action"` as a third level creates one file per action under each module.

## All config options

```ts
import { FileLog } from "@warlock.js/logger";

new FileLog({
  // Directory where log files are stored. Created automatically.
  // @default process.cwd() + "/storage/logs"
  storagePath: process.cwd() + "/storage/logs",

  // Base file name (without extension). @default "app"
  name: "app",

  // File extension. Ignored by JSONFileLog (always "json"). @default "log"
  extension: "log",

  // How to split entries across files. @default "single"
  chunk: "daily",

  // Enable rotation when the active file exceeds maxFileSize. @default true
  rotate: true,

  // Max file size in bytes before rotation. Only checked when rotate is true.
  // @default 10485760 (10 MB)
  maxFileSize: 10 * 1024 * 1024,

  // Day.js format used in the rotated file's name. @default "DD-MM-YYYY"
  rotateFileName: "DD-MM-YYYY",

  // Messages held in memory before flushing. Also flushed every 5s. @default 100
  maxMessagesToWrite: 100,

  // Arrange files into a subdirectory hierarchy. Order = nesting depth.
  groupBy: ["level", "module"],

  // Restrict which levels this channel handles. Omit to handle all.
  levels: ["info", "warn", "error"],

  // Custom filter predicate. Return false to suppress. Runs after levels.
  filter: (data) => data.module !== "health",

  // Day.js format strings for the date/time in each line.
  dateFormat: { date: "DD-MM-YYYY", time: "HH:mm:ss" },
});
```

The full option shape is [`FileLogConfig`](../reference/03-channel-configurations/).

:::tip[Production setup]
For the standard "daily rotating file that flushes on shutdown" wiring — plus a separate errors-only file — see the recipe [Log to a rotating file in production](../recipes/01-rotating-file-in-production/).
:::
