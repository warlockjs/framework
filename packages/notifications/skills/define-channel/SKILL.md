---
name: define-channel
description: 'Add a custom notification channel — `defineChannel<P>({ name, route?, send })` returns a `Channel<P>` you register in the `channels` map of `setNotificationConfig`. `name` matches the key in `NotificationChannels` (extend via `declare module` for typing); `route(notifiable)` resolves the recipient''s address (defaults to `{ id }` when omitted); `send({ payload, route, notifiable, options })` does the actual transport. Use for Slack/Discord/internal-webhook/anything else — `fetch`-based with NO SDK is the simplest variant. Channels that load a heavy SDK should follow the lazy-import pattern from the develop-feature playbook. Triggers: `defineChannel`, `Channel<P>`, "custom notification channel", "add discord channel", "slack channel", "webhook channel", "new channel type", `declare module "@warlock.js/notifications"`; typical import `import { defineChannel } from "@warlock.js/notifications"`. Skip: lazy-loading an optional SDK behind the channel — `D:/xampp/htdocs/mongez/node/.claude/skills/develop-warlock.js-feature/SKILL.md`; using built-in channels — `@warlock.js/notifications/configure-notifications/SKILL.md`.'
---

# `defineChannel` — custom channels

The escape hatch for channel types the package doesn't ship.

## Minimal — `fetch`-based webhook (no SDK)

```ts title="src/app/notifications/channels/discord.channel.ts"
import { defineChannel } from "@warlock.js/notifications";

type DiscordPayload = { content: string };

export const discordChannel = () =>
  defineChannel<DiscordPayload>({
    name: "discord",
    route: (notifiable) => notifiable.get("discord_webhook") as string,
    async send({ payload, route }) {
      const response = await fetch(route as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Discord send failed: ${response.status}`);
    },
  });

// Teach TypeScript about the new channel — picks up notify.discord and
// `defineNotification` typing.
declare module "@warlock.js/notifications" {
  interface NotificationChannels {
    discord: DiscordPayload;
  }
}
```

Register in `config/notifications.ts`:

```ts
channels: {
  // ...
  discord: discordChannel(),
}
```

Now `notify.discord(user, { content: "🎉" })` works, and `discord:` is a valid renderer key in `defineNotification`.

## `route` resolution

| What `route` returns | Effect |
|---|---|
| `string` | Used directly as the address (`"user@example.com"`, webhook URL). |
| `{ id: Id }` | The recipient's storage id — for database/internal channels. |
| `undefined` | Dispatcher falls back to `{ id: notifiable.id }`. |
| `route` omitted | Same as returning `undefined` — `{ id }` fallback. |

For raw-target ad-hoc sends (`notify.discord("https://hooks.../foo", payload)`), the raw string wins over `route()`.

## `send` — the contract

```ts
async send({
  payload,      // P — the channel's payload type
  route,        // string | { id: Id } — resolved by `route()` or raw target
  notifiable,   // Notifiable | undefined — undefined for raw-target ad-hoc
  options,      // SendOptions — delay/locale/meta/idempotencyKey/force/type
}): Promise<void>
```

Throw to fail the send. The dispatcher catches per channel, fires a `failed` event, and continues with siblings (per-channel isolation).

## SDK-backed channels — lazy-import the SDK

Channels that wrap a heavy SDK (Twilio, Slack SDK, FCM SDK) should follow the lazy-import pattern so apps that don't use them don't pay the install/load cost. The recipe + race-safe template lives in [`develop-warlock.js-feature`](../../../../.claude/skills/develop-warlock.js-feature/SKILL.md) — copy from there; do not invent a variant.

Sketch:

```ts
import type { WebClient } from "@slack/web-api";
let Slack: typeof import("@slack/web-api");
let isModuleExists: boolean | null = null;

async function loadSlack() { /* try/catch await import; set flag */ }
loadSlack();

export const slackChannel = (config: { token: string }) =>
  defineChannel<{ text: string }>({
    name: "slack",
    route: (n) => n.get("slack_channel"),
    async send({ payload, route }) {
      await loadSlack();
      if (!isModuleExists) throw new Error(INSTALL_INSTRUCTIONS);
      const client = new Slack.WebClient(config.token);
      await client.chat.postMessage({ channel: route as string, text: payload.text });
    },
  });
```

## See also

- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — register channels in the config.
- [`send-ad-hoc/SKILL.md`](../send-ad-hoc/SKILL.md) — `notify.<custom-channel>` works after registration.
- [`define-notification/SKILL.md`](../define-notification/SKILL.md) — multi-channel renderers with the custom channel key.
- `D:/xampp/htdocs/mongez/node/.claude/skills/develop-warlock.js-feature/SKILL.md` — lazy-import pattern for SDK-backed channels.
