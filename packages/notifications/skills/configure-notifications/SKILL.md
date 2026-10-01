---
name: configure-notifications
description: 'Wire `@warlock.js/notifications` via a declarative `src/config/notifications.ts` that exports a `NotificationConfig` default — the notifications connector registers it at boot, so app code never calls `setNotificationConfig`. `channels`: registry mapping name → factory result (`mailChannel`, `inApp.configure`, custom `defineChannel`); `queue`: optional `QueueDispatcher` (`.queue()` throws without it); `preferences`: optional `PreferenceProvider` (drops channels the recipient muted); `rateLimit`: optional `RateLimiter` (drops channels exceeding per-recipient budgets). Triggers: `config/notifications.ts`, `NotificationConfig`, `setNotificationConfig`, `getNotificationConfig`, `mailChannel`, `inApp.configure`, "configure notifications", "wire notifications at boot", "set preferences provider", "set rate limit"; typical import `import { type NotificationConfig, mailChannel, inApp } from "@warlock.js/notifications"`. Skip: building a reusable notification — the `define-notification` topic; the in-app read API — the `use-in-app` topic; adding a custom channel — the `define-channel` topic.'
---

# Configure notifications

`src/config/notifications.ts` exports a `NotificationConfig` as its default; the notifications connector registers it at boot and the dispatcher reads from it on every send. The file is **declarative** — you never call `setNotificationConfig` yourself (the connector does, the same way the rest of `src/config/*.ts` is wired).

> `npx warlock add notifications` ejects this file pre-wired (mail + in-app) alongside the `Notification` model + migration and the recipient-scoped read/dismiss routes + controllers. Edit the ejected config to taste — the sections below are the full surface.

## Minimal

```ts title="src/config/notifications.ts"
import { type NotificationConfig, inApp, mailChannel } from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

const config: NotificationConfig = {
  channels: {
    mail:     mailChannel({ from: "no-reply@store.com" }),
    database: inApp.configure({ model: Notification }),
  },
};

export default config;
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
  queue: heraldQueue(),                    // backs `.queue()` (needs @warlock.js/herald)
};

export default config;
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

// 10% case — pass a custom repo (only for EXTRA query methods; column names
// come from the model's columnMap, not a repo override).
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

Tests call `setNotificationConfig` directly — bypassing the connector — to set state, then `resetNotificationConfig` to tear down:

```ts
import { resetNotificationConfig, setNotificationConfig } from "@warlock.js/notifications";

beforeEach(() => setNotificationConfig({ channels: { ... } }));
afterEach(() => resetNotificationConfig());
```

## See also

- The `notifications-basics` topic — package front door.
- The `define-notification` topic — reusable multi-channel definitions.
- The `use-in-app` topic — in-app read API.
- The `define-channel` topic — custom channels.
