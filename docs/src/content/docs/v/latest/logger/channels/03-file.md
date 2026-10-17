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

The `chunk` option controls how entries split across files. Dated names are ISO dates, so the files sort by name in date order.

| Value      | Description                        | Example filename    |
| ---------- | ---------------------------------- | ------------------- |
| `"single"` | One file for all entries (default) | `app.log`           |
| `"daily"`  | One file per calendar day          | `2024-03-15.log`    |
| `"hourly"` | One file per hour                  | `2024-03-15-10.log` |

```ts
// One file per day — good balance of granularity and file count
new FileLog({ storagePath: "./storage/logs", chunk: "daily" });

// One file per hour — useful for high-volume services
new FileLog({ storagePath: "./storage/logs", chunk: "hourly" });
```

### Custom file names — `fileName`

`fileName` names the file yourself. It is a pattern or a function of the current date, evaluated at every write, so a dated name starts a new file whenever it changes. When set, it replaces the chunk's default name.

| Token    | Value (local time) |
| -------- | ------------------ |
| `{YYYY}` | year, `2024`       |
| `{MM}`   | month, `03`        |
| `{DD}`   | day of month, `15` |
| `{HH}`   | hour, `00`–`23`    |
| `{mm}`   | minute, `00`–`59`  |
| `{name}` | the `name` option  |

```ts
// app-2024-03-15.log, app-2024-03-16.log, …
new FileLog({ storagePath: "./storage/logs", fileName: "app-{YYYY}-{MM}-{DD}" });

// Same, using the `name` option
new FileLog({ storagePath: "./storage/logs", name: "api", fileName: "{name}-{YYYY}-{MM}-{DD}" });

// A function of the date: one file per quarter, audit-2024-Q1.log
new FileLog({
  storagePath: "./storage/logs",
  fileName: (date) => `audit-${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`,
});

// The pre-5.31 daily name: 15-03-2024.log
new FileLog({ storagePath: "./storage/logs", chunk: "daily", fileName: "{DD}-{MM}-{YYYY}" });
```

Without `fileName`, a `daily` or `hourly` chunk ignores `name`: give two dated channels in one directory distinct `fileName` patterns (or separate `storagePath`s) so they don't share a file.

## File rotation

With `rotate: true` (the default), `FileLog` checks the active file size before each write. Once it exceeds `maxFileSize` bytes, the file is renamed with a timestamp suffix and a fresh file is opened:

```
storage/logs/
├── app.log                              ← active file (fresh after rotation)
└── app-15-03-2024-1710494523000.log     ← rotated archive
```

The rotated name is `<file name>-<rotateFileName>-<epoch ms>.<extension>`, in the rotated file's own directory (a group directory with `groupBy`). `rotateFileName` takes the same forms as `fileName` — a token pattern or a function of the rotation date — and defaults to `{YYYY}-{MM}-{DD}`. Text without tokens is used as is.

```ts
new FileLog({
  storagePath: "./storage/logs",
  rotate: true,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  rotateFileName: "{YYYY}{MM}{DD}-{HH}{mm}", // app-20240315-1022-1710494523000.log
});
```

## Retention — pruning old files

`retention` removes old log files so a long-lived host doesn't fill its disk. It runs when the channel boots and whenever it starts a new file (a size rotation, or a dated name rolling over). Call `await channel.prune()` to run it on demand.

```ts
new FileLog({
  storagePath: "./storage/logs",
  chunk: "daily",
  retention: {
    maxFiles: 14, // keep the 14 newest files (the one being written counts)
    maxAgeDays: 30, // and remove any last modified more than 30 days ago
  },
});
```

- **Only this channel's files.** A file is considered only if it sits in the log directory (each group directory with `groupBy`) and its name matches the channel's file name pattern — the `fileName` (or chunk default) plus an optional rotation suffix, with the channel's extension. Other files, directories and differently named logs are never touched.
- **Newest by modification time.** `maxFiles` keeps the most recently modified files; `maxAgeDays` removes those last modified longer ago. Set either or both. The file being written is never removed.
- **A function `fileName` needs `retention.match`.** The channel can't derive a pattern from a function, so give the regular expression your names match (tested against the file name with extension): `retention: { maxFiles: 8, match: /^audit-\d{4}-Q[1-4]\.log$/ }`. When set, `match` replaces the derived pattern for any `fileName`.
- **Never throws into logging.** A file that can't be read or removed is reported to the logger's [`onChannelError`](../reference/01-logger/) handler (entry `module: "logger"`, `action: "retention"`) and pruning continues; a channel not added to a logger writes one stderr line instead.

`maxFiles` must be a positive integer and `maxAgeDays` a positive number; the constructor throws a `TypeError` otherwise.

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

  // File name pattern or (date) => string; replaces the chunk's default name.
  // @default by chunk: name | "{YYYY}-{MM}-{DD}" | "{YYYY}-{MM}-{DD}-{HH}"
  fileName: "app-{YYYY}-{MM}-{DD}",

  // Remove old files on boot and when a new file starts. @default none
  retention: { maxFiles: 14, maxAgeDays: 30 },

  // Enable rotation when the active file exceeds maxFileSize. @default true
  rotate: true,

  // Max file size in bytes before rotation. Only checked when rotate is true.
  // @default 10485760 (10 MB)
  maxFileSize: 10 * 1024 * 1024,

  // Middle part of a rotated file's name; pattern or (date) => string.
  // @default "{YYYY}-{MM}-{DD}"
  rotateFileName: "{YYYY}-{MM}-{DD}",

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
