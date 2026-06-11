---
name: configure-notifications
description: 'Wire `@warlock.js/notifications` at boot — `setNotificationConfig({ default, channels, queue?, preferences?, rateLimit? })` exports the active config the dispatcher reads. `default`: channels used as fallback when no `via` is given; `channels`: registry mapping name → factory result (`mailChannel`, `inApp.configure`, custom `defineChannel`); `queue`: optional `QueueDispatcher` (`.queue()` throws without it); `preferences`: optional `PreferenceProvider` (drops channels the recipient muted); `rateLimit`: optional `RateLimiter` (drops channels exceeding per-recipient budgets). Triggers: `setNotificationConfig`, `getNotificationConfig`, `NotificationConfig`, `config/notifications.ts`, `mailChannel`, `inApp.configure`, "configure notifications", "wire notifications at boot", "set preferences provider", "set rate limit"; typical import `import { type NotificationConfig, mailChannel, inApp, setNotificationConfig } from "@warlock.js/notifications"`. Skip: building a reusable notification — `@warlock.js/notifications/define-notification/SKILL.md`; the in-app read API — `@warlock.js/notifications/use-in-app/SKILL.md`; adding a custom channel — `@warlock.js/notifications/define-channel/SKILL.md`.'
---

# Configure notifications

One call at boot wires every channel + the optional gates. The dispatcher reads from this config on every send.

## Minimal

```ts title="src/config/notifications.ts"
import {
  type NotificationConfig,
  inApp,
  mailChannel,
  setNotificationConfig,
} from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

const config: NotificationConfig = {
  channels: {
    mail:     mailChannel({ from: "no-reply@store.com" }),
    database: inApp.configure({ model: Notification }),
  },
};

setNotificationConfig(config);
```

The `database` channel is returned by `inApp.configure({ model | repository })` — it binds the in-app store AND returns the channel, so the read side + the write side share ONE repository instance.

## Full surface

```ts
const config: NotificationConfig = {
  channels: {
    mail:     mailChannel({ from }),
    database: inApp.configure({ model: Notification }),

    // custom channels
    discord:  discordChannel(),            // defineChannel + declare module
  },

  // optional gates — both app-owned; package ships no defaults
  preferences: userPreferences,            // drops channels recipient muted
  rateLimit,                               // drops channels over budget
  queue: heraldQueue,                      // backs `.queue()` (Phase 2)
};

setNotificationConfig(config);
```

## Channel keys must match the registry

`channels: { mail, database, discord }` — keys correspond to `NotificationChannels` entries. Built-ins (`mail`, `database`) ship in the registry; custom channels extend it with `declare module`.

```ts
// in your custom channel file
declare module "@warlock.js/notifications" {
  interface NotificationChannels {
    discord: { content: string };
  }
}
```

After that, `notify.discord(...)`, `via: ["discord"]`, and the `discord:` key in `defineNotification` all autocomplete + type-check.

## `inApp.configure({ model | repository })`

Two paths; mutually exclusive at the type level.

```ts
// 90% case — pass the model class; default repo built internally.
database: inApp.configure({ model: Notification }),

// 10% case — pass a custom repo (when you need filterBy overrides or extras).
database: inApp.configure({ repository: notificationsRepository }),
```

There is NO zero-arg form — the package ships no concrete table/model.

## `preferences` — pre-send opt-in gate (optional)

```ts
import type { PreferenceProvider } from "@warlock.js/notifications";

export const userPreferences: PreferenceProvider = {
  resolveChannels(user, type, requested) {
    const muted: Record<string, string[]> = user.get("preferences.muted") ?? {};
    return requested.filter((c) => !(muted[c] ?? []).includes(type));
  },
};
```

Dropped channels fire a `skipped` event with reason `"preference"`. `SendOptions.force === true` bypasses this gate.

## `rateLimit` — pre-send safety valve (optional)

```ts
import { cache } from "@warlock.js/cache";
import type { RateLimiter } from "@warlock.js/notifications";

export const rateLimit: RateLimiter = {
  async allow(user, channel, type) {
    const key = `notif.rl.${user.id}.${channel}.${type}`;
    const count = await cache.increment(key, 1);
    if (count === 1) await cache.set(key, 1, { ttl: 3600 });
    return count <= 5;
  },
};
```

Dropped channels fire a `skipped` event with reason `"rate-limit"`. `force` does NOT bypass this — rate limits are a safety valve, not a UX preference.

## Reading the config back

```ts
import { getNotificationConfig } from "@warlock.js/notifications";

const cfg = getNotificationConfig();   // throws NotificationsNotConfiguredError if unset
```

## Tests

For tests, reset between cases:

```ts
import { resetNotificationConfig, setNotificationConfig } from "@warlock.js/notifications";

beforeEach(() => setNotificationConfig({ channels: { ... } }));
afterEach(() => resetNotificationConfig());
```

## See also

- [`notifications-basics/SKILL.md`](../notifications-basics/SKILL.md) — package front door.
- [`define-notification/SKILL.md`](../define-notification/SKILL.md) — reusable multi-channel definitions.
- [`use-in-app/SKILL.md`](../use-in-app/SKILL.md) — in-app read API.
- [`define-channel/SKILL.md`](../define-channel/SKILL.md) — custom channels.
