---
title: "Channel configurations"
description: "Every option on every built-in channel — ConsoleLogConfig and FileLogConfig."
sidebar:
  order: 3
  label: "Channel configurations"
---

Every built-in channel extends `BasicLogConfigurations` (the shared options — `levels`, `dateFormat`, `filter`, `context`, `redact`; see [Types](./04-types/)) and adds its own fields.

## `ConsoleLogConfig`

`ConsoleLog` options — `BasicLogConfigurations` plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `showContext` | `boolean` | `false` | Render the entry's `context` on a second line via `util.inspect`. When `false`, context is dropped from console output (file/JSON channels still keep it). |
| `contextDepth` | `number` | `4` | Depth passed to `util.inspect` when rendering context. Only applies when `showContext` is enabled. |

## `FileLogConfig`

`FileLog` options — `BasicLogConfigurations` plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `storagePath` | `string` | `process.cwd() + "/storage/logs"` | Directory where log files are stored. Created automatically. |
| `name` | `string` | `"app"` | Base file name, without extension. |
| `chunk` | `"single" \| "daily" \| "hourly"` | `"single"` | How entries split across files. |
| `rotate` | `boolean` | `true` | Rotate the file when it exceeds `maxFileSize`. |
| `extension` | `string` | `"log"` | File extension. Ignored by `JSONFileLog` (always `"json"`). |
| `rotateFileName` | `string` | `"DD-MM-YYYY"` | Day.js format string used in the rotated file's name (`{name}-{rotateFileName}-{Date.now()}.{extension}`). |
| `maxFileSize` | `number` | `10485760` (10 MB) | Max bytes before rotation. Only checked when `rotate` is `true`. |
| `maxMessagesToWrite` | `number` | `100` | Messages held in the in-memory buffer before flushing. Also flushed every 5 seconds. |
| `groupBy` | `("level" \| "module" \| "action")[]` | none | Arrange files into a subdirectory hierarchy. Order = nesting depth. |

`FileLogConfig` also re-declares `levels` and `dateFormat` from the shared base, so they're available alongside the file-specific options.

## `JSONFileLog`

`JSONFileLog` **extends `FileLog`** — it accepts the entire `FileLogConfig` shape and behaves identically for chunking, rotation, buffering, and `groupBy`. The one override: `extension` is forced to `"json"` regardless of what you pass.

See [JSON File Channel](../channels/04-json-file/) for the output-format differences.

## `SentryLogConfig`

`SentryLog` options — `BasicLogConfigurations` plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `client` | Sentry namespace / forwarder | — | Reuse an already-initialized Sentry instance (e.g. the `@sentry/node` namespace). |
| `options` | `SentryInitOptions` | — | Sentry init options (mirrors `@sentry/node`'s `NodeOptions`), used when the channel owns initialization. |
| `eventLevels` | `LogLevel[]` | `["error", "warn"]` | Levels delivered as Sentry events; every other level becomes a breadcrumb. |
| `flushTimeout` | `number` | `2000` | Milliseconds `flush()` waits for the Sentry transport to drain on shutdown. |

`@sentry/node` is an optional peer — install it only when using this channel. See [Sentry channel](../channels/06-sentry/).

## See also

- [Channels Overview](../channels/01-overview/) — the shared options in practice
- [Types · `BasicLogConfigurations`](./04-types/) — the base every config extends
