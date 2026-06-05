---
name: pick-log-channel
description: 'Pick one of the three built-in channels — ConsoleLog (terminal), FileLog (plain text on disk), JSONFileLog (structured JSON for aggregators like Loki / Datadog / Elastic). Triggers: `ConsoleLog`, `FileLog`, `JSONFileLog`, `chunk`, `rotate`, `groupBy`, `maxFileSize`, `showContext`, `log.channel`; "log to a file", "rotate log files", "daily log chunks", "json logs for datadog / loki / elastic"; typical import `import { ConsoleLog, FileLog, JSONFileLog } from "@warlock.js/logger"`. Skip: custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; registration — `@warlock.js/logger/configure-logger/SKILL.md`; competing libs `winston-daily-rotate-file`, `pino-pretty`.'
---

# Channels — which one to pick and how to configure it

Four built-in channels (`SentryLog` needs the optional `@sentry/node` peer). A channel is a destination for a log entry — the logger fans out every entry to every registered channel in parallel.

## The decision

| Need | Pick |
|---|---|
| Local dev, colored output in the terminal | `ConsoleLog` |
| Plain text `.log` files on disk — humans read them | `FileLog` |
| Structured `.json` files — a log aggregator (Loki / Datadog / Elastic) reads them | `JSONFileLog` |
| Errors & warnings into Sentry (events + breadcrumbs) | `SentryLog` |

Most production setups use **two** channels: `ConsoleLog` + one file channel. Dev uses `ConsoleLog` only.

## `ConsoleLog`

Zero config. Colored, icon-prefixed lines to the terminal.

```ts
import { ConsoleLog } from "@warlock.js/logger";

new ConsoleLog();
// ⚙ (2024-03-15T10:22:00.000Z) [auth] [hashPassword] Hashing started
// ℹ (2024-03-15T10:22:01.482Z) [users] [register] New user created
// ✗ (2024-03-15T10:22:03.111Z) [payments] [charge] Card declined
```

Properties:
- `name = "console"`, `terminal = true`
- Accepts `ConsoleLogConfig` — `levels`, `filter`, `dateFormat`, `showContext`, `contextDepth`
- If `message` is an object, a second `console.log(message)` is issued so Node's inspector can expand it

### Showing context

By default `ConsoleLog` drops the `context` payload (the file/JSON channels still keep it). Flip `showContext: true` to render it on a second line — useful in development:

```ts
new ConsoleLog({ showContext: true });

log.info("payments", "charge", "card declined", { userId: 42, amount: 1999 });
// ℹ (…) [payments] [charge] card declined
//   ↳ { userId: 42, amount: 1999 }
```

Tune `contextDepth` (default `4`) to clamp how deep `util.inspect` recurses into nested objects.

## `FileLog`

Plain text. Buffers in memory, flushes to disk periodically.

```ts
import { FileLog } from "@warlock.js/logger";

new FileLog({
  storagePath: "./storage/logs",  // default: process.cwd() + "/storage/logs"
  name: "app",                    // default: "app"
  extension: "log",               // default: "log"
  chunk: "daily",                 // "single" (default) | "daily" | "hourly"
  rotate: true,                   // default: true
  maxFileSize: 10 * 1024 * 1024,  // default: 10MB — triggers rotation
  maxMessagesToWrite: 100,        // default: 100 — flush threshold
  groupBy: ["level", "module"],   // optional subdirectory nesting
});
```

Line format: `[date time] [level] [module][action]: message` — or a `[trace]` block when `message` is an `Error`.

### Key gotchas

- **Buffers!** Messages sit in memory until either `maxMessagesToWrite` is reached, 5 seconds pass, or `flushSync()` is called. A process that crashes without flushing loses buffered entries.
- **`chunk: "daily"` picks a filename per day.** File name becomes `DD-MM-YYYY.log`. Combined with `rotate: true`, rotated archives get `Date.now()` suffixed.
- **`groupBy` nests directories.** `groupBy: ["level", "module"]` produces `storage/logs/error/payments/app.log`. Order matters.
- **Dispose channels you discard.** A live `FileLog` keeps a 5-second flush interval running. If you swap the channel list at runtime (reconfigure the logger), call `channel.dispose()` on the old instance — it clears that timer and drains the buffer one last time. Skipping it leaks one timer per discarded channel and keeps the event loop alive. (Channels that live for the whole process don't need this — process exit clears the timer.)

## `JSONFileLog`

Subclass of `FileLog` — same buffering, chunking, rotation, grouping. Output is a JSON object with a `messages` array:

```json
{
  "messages": [
    {
      "content": "Card declined",
      "level": "error",
      "date": "15-03-2024 10:22:03",
      "module": "payments",
      "action": "charge",
      "stack": [
        "Error: Card declined",
        "    at chargeCard (/app/src/payments.ts:42:11)"
      ]
    }
  ]
}
```

Differences from `FileLog`:
- `name = "fileJson"` (**not** `"json"` — use this exact string for `log.channel("fileJson")`)
- `extension` is always `"json"` — the option is silently ignored
- Error `stack` is stored as `string[]` (split on newlines) — easy to query in aggregators
- `content` holds the original user-supplied `message` (not a pre-formatted line)
- Corrupted existing file → reinitialized to `{ messages: [] }` on next write (does not throw)
- **Safe serialization by construction.** All writes go through `safe-stable-stringify` with a custom `Error` replacer — circular refs become `"[Circular]"`, BigInt is stringified, functions/symbols are dropped, nested `Error` instances expand to `{ name, message, stack, ...enumerable }`. A context payload with a class graph or circular reference will never throw during the write.

## `SentryLog`

Forwards entries to Sentry — `error` / `warn` become events (`captureException` for `Error` messages, `captureMessage` otherwise), every other level a breadcrumb (no quota). `@sentry/node` is an optional peer, lazily imported; pass an existing `client` or `options`.

```ts
import * as Sentry from "@sentry/node";
import { SentryLog } from "@warlock.js/logger";

new SentryLog({ client: Sentry, eventLevels: ["error", "warn"] });
```

Full guide — level mapping, init modes, shutdown draining: [`ship-logs-to-sentry`](@warlock.js/logger/ship-logs-to-sentry/SKILL.md).

## Shared config — `BasicLogConfigurations`

Every channel constructor accepts at minimum:

```ts
type BasicLogConfigurations = {
  levels?: LogLevel[];                       // whitelist — omit or [] to allow all
  filter?: (data: LoggingData) => boolean;   // custom predicate
  dateFormat?: { date?: string; time?: string }; // Day.js format strings
  context?: (data) => Promise<Record<string, any>>; // reserved — not yet read
};
```

Concrete file channels extend this with their storage/chunk/rotate/groupBy options via intersection.

## Picking a channel by name at runtime

```ts
log.channel("console");   // → ConsoleLog | undefined
log.channel("file");      // → FileLog | undefined
log.channel("fileJson");  // ← note the name — NOT "json"
log.channel("sentry");    // → SentryLog | undefined
```

If two channels share a `name`, only one is reachable this way — the search returns the first match.

## See also

- [`@warlock.js/logger/configure-logger/SKILL.md`](@warlock.js/logger/configure-logger/SKILL.md) — registering channels at startup
- [`@warlock.js/logger/filter-log-entries/SKILL.md`](@warlock.js/logger/filter-log-entries/SKILL.md) — `levels` and `filter` config in detail
- [`@warlock.js/logger/ship-logs-to-sentry/SKILL.md`](@warlock.js/logger/ship-logs-to-sentry/SKILL.md) — the `SentryLog` channel in depth
- [`@warlock.js/logger/write-custom-log-channel/SKILL.md`](@warlock.js/logger/write-custom-log-channel/SKILL.md) — extending `LogChannel` for custom sinks
