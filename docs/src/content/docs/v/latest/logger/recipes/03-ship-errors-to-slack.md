---
title: "Ship errors to Slack (or any external channel)"
description: "Build a custom channel that POSTs error-level logs to a Slack webhook — and the pattern for any HTTP sink."
sidebar:
  order: 3
  label: "Errors to Slack"
---

You want `error` (and maybe `warn`) entries to land in a Slack channel so the team sees production failures without tailing a file. The logger doesn't bundle network sinks, but a custom channel is ~15 lines: extend `LogChannel`, filter to the levels you care about, and POST.

## The Slack channel

```ts title="src/channels/slack-log.ts"
import { LogChannel, type BasicLogConfigurations, type LoggingData } from "@warlock.js/logger";

// Extend the base config so the inherited `levels`, `filter`, and `redact`
// options are part of the type the channel accepts.
type SlackConfig = BasicLogConfigurations & {
  webhookUrl: string;
};

export class SlackLog extends LogChannel<SlackConfig> {
  public name = "slack";

  public async log(data: LoggingData) {
    // Inherit the levels whitelist + filter predicate for free.
    if (!this.shouldBeLogged(data)) {
      return;
    }

    const { type, module, action, message } = data;

    await fetch(this.config("webhookUrl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: *[${type.toUpperCase()}]* \`${module}\` › \`${action}\`\n${message}`,
      }),
    });
  }
}
```

## Register it for errors only

```ts title="src/logger.ts"
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";
import { SlackLog } from "./channels/slack-log";

log.setChannels([
  new ConsoleLog(), // everything to the terminal
  new FileLog({ chunk: "daily" }), // everything to disk
  new SlackLog({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    levels: ["fatal", "error", "warn"], // ← only these reach Slack
  }),
]);
```

The `levels: ["fatal", "error", "warn"]` whitelist means `debug` / `info` / `success` never hit the network — `shouldBeLogged` drops them before your `fetch` runs. The console and file channels still see everything; filtering is per channel. Include `fatal` so unrecoverable failures (`uncaughtException`, failed bootstrap) ring the same Slack channel as everything else worth paging on.

## Don't let a flaky webhook crash your app

A channel's `log()` is fired without being awaited by the logger, so an unhandled rejection from `fetch` could take down the process. Swallow transport failures inside the channel:

```ts
public async log(data: LoggingData) {
  if (!this.shouldBeLogged(data)) {
    return;
  }

  try {
    await fetch(this.config("webhookUrl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: this.format(data) }),
    });
  } catch {
    // A logging sink must never be the thing that crashes the app.
    // Drop the Slack delivery; the console + file channels still recorded it.
  }
}
```

:::tip[The same shape works for any HTTP sink]
Datadog, Loki, a generic webhook, Sentry — they're all this pattern: `extend LogChannel`, `shouldBeLogged`, then POST the formatted entry. Swap the URL and the body shape. For high volume, buffer in the channel and flush in batches rather than one request per entry.
:::

## Redact before it leaves your machine

Slack is an external destination — scrub secrets harder for it than for your local file. Per-channel `redact` paths are **additive** on top of the logger floor (a channel can redact more, never less):

```ts
new SlackLog({
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  levels: ["error"],
  redact: {
    paths: ["context.user.email", "context.token"],
  },
});
```

See [Redaction](../advanced/01-redaction/) for how the floor and per-channel paths combine.

## See also

- [Custom Channel](../channels/05-custom/) — the full `LogChannel` contract, the `init()` hook, and `flushSync`
- [Filtering](../channels/01-overview/) — the `levels` whitelist and `filter` predicate
- [Redaction](../advanced/01-redaction/) — additive per-channel redaction
