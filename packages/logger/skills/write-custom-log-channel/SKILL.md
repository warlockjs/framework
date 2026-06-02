---
name: write-custom-log-channel
description: 'Extend the abstract LogChannel class for custom sinks — Slack, database, HTTP endpoint, in-memory buffer. Triggers: `LogChannel`, `LogContract`, `LoggingData`, `shouldBeLogged`, `init`, `flushSync`, `terminal`; "log to slack", "log to a database", "send logs to datadog / loki HTTP api", "in-memory test capture channel", "build a custom log sink"; typical import `import { LogChannel, type LoggingData, type LogContract } from "@warlock.js/logger"`. Skip: built-in channels — `@warlock.js/logger/pick-log-channel/SKILL.md`; filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; competing libs `winston-transport`, `pino-transport`.'
---

# Custom channels — extending `LogChannel`

Build a sink for any destination — Slack, a database, an HTTP endpoint — by extending the abstract `LogChannel` class.

## The 5-line minimum

```ts
import { LogChannel, type LoggingData } from "@warlock.js/logger";

export class NullChannel extends LogChannel {
  public name = "null";
  public log(_data: LoggingData) {}
}
```

Then:
```ts
log.addChannel(new NullChannel());
```

That's a working channel. `LogChannel` provides the scaffolding; you only need to supply `name` and `log()`.

## What `LogChannel` gives you

| Thing | Who provides it |
|---|---|
| `name`, `description`, `terminal` | You (fields on your subclass) |
| `log(data)` | **You must implement** — abstract |
| `flushSync()` | You (optional — only if you buffer) |
| `init()` | You (optional async hook — see below) |
| `shouldBeLogged(data)` | `LogChannel` — combines `levels` + `filter` |
| `config<K>(key)` | `LogChannel` — merges user config with `defaultConfigurations` |
| `getDateAndTimeFormat()` | `LogChannel` — returns resolved `dateFormat` |

## Complete example — SlackLog

```ts title="src/channels/slack-log.ts"
import { LogChannel, type BasicLogConfigurations, type LoggingData } from "@warlock.js/logger";

// `LogChannel<Options>` constrains `Options extends BasicLogConfigurations`,
// so extend the base to keep the inherited levels / filter / redact options.
type SlackConfig = BasicLogConfigurations & {
  webhookUrl: string;
};

export class SlackLog extends LogChannel<SlackConfig> {
  public name = "slack";
  public description = "Posts errors + warnings to a Slack webhook";

  public async log(data: LoggingData) {
    if (!this.shouldBeLogged(data)) return;   // ← inherit levels + filter

    await fetch(this.config("webhookUrl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[${data.type.toUpperCase()}] [${data.module}][${data.action}]: ${data.message}`,
      }),
    });
  }
}
```

Register it alongside built-ins:

```ts
log.setChannels([
  new ConsoleLog(),
  new FileLog({ chunk: "daily" }),
  new SlackLog({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    levels: ["error", "warn"],
  }),
]);
```

## The `init()` hook

Override `protected async init()` for one-time setup — open a socket, connect to a DB, prepare a write stream. Runs automatically after construction (inside a `setTimeout(0)`); `isInitialized` flips to `true` once resolved.

```ts
export class DatabaseLog extends LogChannel<
  BasicLogConfigurations & { connectionString: string }
> {
  public name = "database";
  private client!: SomeDbClient;

  protected async init() {
    this.client = await SomeDbClient.connect(this.config("connectionString"));
  }

  public async log(data: LoggingData) {
    if (!this.shouldBeLogged(data)) return;
    await this.client.insert("logs", data);
  }
}
```

## Implementing `flushSync()`

Only if your channel buffers. Signature: `flushSync?(): void`. Synchronous — no `await`, no promises.

```ts
export class BatchHttpLog extends LogChannel<BasicLogConfigurations & { url: string }> {
  public name = "batch-http";
  private buffer: LoggingData[] = [];

  public log(data: LoggingData) {
    if (!this.shouldBeLogged(data)) return;
    this.buffer.push(data);
    if (this.buffer.length >= 100) void this.drain();
  }

  public flushSync() {
    // Synchronous HTTP — use `node:http` or `XMLHttpRequest` polyfill.
    // If sync HTTP isn't possible, at least dump the buffer to disk here
    // so a follow-up async drain can recover it next boot.
  }

  private async drain() { /* async post to this.config("url") */ }
}
```

## The `terminal` property

- `terminal = true` (ConsoleLog default) → the logger passes the **original** message, ANSI codes intact.
- `terminal = false` (base default, all file channels) → the logger passes a shallow-cloned copy whose `message` has ANSI codes stripped.

Set `terminal = true` on a channel only if its output is a TTY that should render colors.

## `LogContract` — the minimal interface

If you don't want anything `LogChannel` provides (level filtering, config merging), implement `LogContract` directly:

```ts
import type { LogContract, LoggingData } from "@warlock.js/logger";

class MinimalSlack implements LogContract {
  public name = "slack";

  public async log(data: LoggingData) {
    if (data.type !== "error") return;
    await fetch(process.env.SLACK_WEBHOOK!, { /* ... */ });
  }
}
```

Prefer extending `LogChannel` unless you have a concrete reason not to — the level/filter plumbing is worth keeping.

## Don't do

- Don't mutate `data` inside `log()`. Later channels see the mutation if the logger passes the same reference.
- Don't throw synchronously from `log()`. The logger fires it without awaiting; an unhandled rejection takes down the process (unless `captureAnyUnhandledRejection` is wired up — and then it's embarrassing to be the cause).
- Don't block the event loop. `log()` may be sync or async; if your work takes >100ms, make it async and return the promise.
- Don't forget `shouldBeLogged(data)` at the top of `log()` — or your channel silently ignores `levels` / `filter` config.
