---
title: "Custom channels"
description: Add your own channel with defineChannel — a fetch-based webhook in 30 lines, plus the declare-module typing.
sidebar:
  label: "Custom channels"
---

`defineChannel` is the escape hatch for any transport the package doesn't ship. A `fetch`-based channel needs no SDK:

```ts title="src/app/notifications/channels/discord.channel.ts"
import { defineChannel } from "@warlock.js/notifications";

type DiscordPayload = { content: string };

export const discordChannel = () =>
  defineChannel<DiscordPayload>({
    name: "discord",
    route: (notifiable) => notifiable.get("discord_webhook") as string,
    async send({ payload, route }) {
      const res = await fetch(route as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Discord send failed: ${res.status}`);
    },
  });

// Teach the registry — now notify.discord(...) and `defineNotification`'s
// `discord:` renderer are typed.
declare module "@warlock.js/notifications" {
  interface NotificationChannels {
    discord: DiscordPayload;
  }
}
```

Register it:

```ts title="config/notifications.ts"
channels: {
  // …built-ins…
  discord: discordChannel(),
}
```

## The `route` contract

| `route()` returns | Meaning |
| --- | --- |
| `string` | The address (URL, email, chat id) |
| `{ id }` | A storage id (database-style channels) |
| `undefined` | Unroutable for this recipient → `UnresolvableRouteError` |
| (no `route`) | Falls back to `{ id: notifiable.id }` |

Throw inside `send` to fail; the dispatcher isolates it as a `failed` event and continues with sibling channels.

## SDK-backed channels — lazy-load the SDK

A channel that wraps a heavy SDK (Slack, Twilio, FCM) should lazily `import()` it so apps that don't use it never pay the cost, and a missing package surfaces as a clear install message. Follow the lazy-import pattern used by cascade/cache drivers.

```ts
import type { WebClient } from "@slack/web-api";
let Slack: typeof import("@slack/web-api");
let loaded: boolean | null = null;
async function loadSlack() { try { Slack = await import("@slack/web-api"); loaded = true; } catch { loaded = false; } }
loadSlack();

export const slackChannel = (config: { token: string }) =>
  defineChannel<{ text: string }>({
    name: "slack",
    route: (n) => n.get("slack_channel"),
    async send({ payload, route }) {
      await loadSlack();
      if (!loaded) throw new Error("Install @slack/web-api to use the slack channel");
      await new Slack.WebClient(config.token).chat.postMessage({ channel: route as string, text: payload.text });
    },
  });
```

> WhatsApp, Telegram, Slack, and push will ship as first-class channels via `@warlock.js/bridges` — the same provider, reused by AI agents and notifications alike.

## Next

- [Channels & the registry](../essentials/01-channels-and-the-registry.md) — how the typing works.
- [Ad-hoc sends](./send-ad-hoc.md) — `notify.<yourChannel>` after registration.
