---
title: "Custom Channel"
description: "Extend LogChannel to send logs anywhere — Slack, a database, an HTTP endpoint, an in-memory buffer."
sidebar:
  order: 5
  label: "Custom"
---

Need to send logs to Slack, a database, or any other destination? Extend `LogChannel` and implement the `log` method. The abstract base class handles configuration merging, level filtering, the `filter` predicate, and date formatting for you.

## Complete example — SlackLog

```ts title="src/channels/slack-log.ts"
import { LogChannel, type BasicLogConfigurations, type LoggingData } from "@warlock.js/logger";

// Extend the base config so the inherited `levels` / `filter` / `redact`
// options are part of the type the channel accepts.
type SlackConfig = BasicLogConfigurations & {
  webhookUrl: string;
};

export class SlackLog extends LogChannel<SlackConfig> {
  public name = "slack";

  public async log(data: LoggingData) {
    // shouldBeLogged checks both the levels list and the filter predicate
    if (!this.shouldBeLogged(data)) return;

    const { type, module, action, message } = data;

    await fetch(this.config("webhookUrl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[${type.toUpperCase()}] [${module}][${action}]: ${message}`,
      }),
    });
  }
}
```

Register it alongside the built-in channels:

```ts title="src/config/log.ts"
import { ConsoleLog, FileLog } from "@warlock.js/logger";
import { SlackLog } from "../channels/slack-log";

const channels = [
  new ConsoleLog(),
  new FileLog({ chunk: "daily" }),
  new SlackLog({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    levels: ["error", "warn"],
  }),
];
```

## The `init()` hook

Override the protected `init()` method for one-time setup that should happen after construction — opening a socket, establishing a database connection, preparing a write stream.

```ts
import { LogChannel, type BasicLogConfigurations, type LoggingData } from "@warlock.js/logger";

type DbConfig = BasicLogConfigurations & { connectionString: string };

export class DatabaseLog extends LogChannel<DbConfig> {
  public name = "database";
  private client!: SomeDbClient;

  protected async init() {
    // Runs once, automatically, after the channel is constructed.
    // The logger waits for this promise before marking the channel ready.
    this.client = await SomeDbClient.connect(this.config("connectionString"));
  }

  public async log(data: LoggingData) {
    if (!this.shouldBeLogged(data)) return;
    await this.client.insert("logs", data);
  }
}
```

:::caution[The init timing window]
`init()` is scheduled on the next tick (`setTimeout(0)`) by the constructor, and the channel is marked ready only once it resolves. Entries logged in the very first tick — before `init()` completes — can reach `log()` before your async setup is done. If your channel writes to a resource that `init()` prepares, guard against it being undefined, or buffer until ready.
:::

## `LogChannel` members

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique identifier for this channel |
| `description` | `string?` | Optional human-readable description |
| `terminal` | `boolean` | `true` preserves ANSI codes; `false` (default) strips them via `clearMessage()` |
| `log(data)` | abstract method | Your write/send logic |
| `shouldBeLogged(data)` | protected method | `false` if `data.type` is not in `levels`, or if `filter` returns `false` |
| `config(key)` | protected method | Type-safe accessor merging provided options with channel defaults |
| `getDateAndTimeFormat()` | protected method | Returns `{ date, time }` Day.js format strings resolved from config |
| `init()` | protected hook | Optional async setup called once after construction |
| `defaultConfigurations` | protected field | Override in subclasses to provide option defaults |
| `getRedactConfig()` | method | Returns the channel's `redact` config (additive on top of the logger floor) |

## `LogContract` vs `LogChannel`

Extend `LogChannel` when you want the built-in handling of `levels` filtering, the `filter` predicate, `dateFormat` config merging, and the `init()` hook — you only provide `log()`.

Implement `LogContract` directly when you want full control with no inherited behavior:

```ts
import type { LogContract, LoggingData } from "@warlock.js/logger";

class SlackChannel implements LogContract {
  name = "slack";
  description = "Sends error logs to a Slack webhook";

  async log(data: LoggingData): Promise<void> {
    if (data.type !== "error") return;
    await fetch(process.env.SLACK_WEBHOOK!, {
      method: "POST",
      body: JSON.stringify({ text: `[${data.module}] ${data.message}` }),
    });
  }
}

log.addChannel(new SlackChannel());
```

`LogChannel` already satisfies `LogContract`. See [Types](../reference/04-types/) for the full interface definitions.

:::tip[Worked example]
For an end-to-end custom channel — including swallowing transport failures and per-channel redaction — see the recipe [Ship errors to Slack](../recipes/03-ship-errors-to-slack/).
:::

:::tip[Implementing `flushSync`]
Override `flushSync(): void` when your channel buffers entries in memory and needs a synchronous drain on shutdown. `FileLog` and `JSONFileLog` both implement it; `ConsoleLog` does not (stdout needs no flushing). Calling `log.flushSync()` fans out to every channel that has it — see [Shutdown & flushing](../advanced/03-shutdown-and-flushing/).
:::
