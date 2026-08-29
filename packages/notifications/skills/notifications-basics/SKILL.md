---
name: notifications-basics
description: 'Front-door for `@warlock.js/notifications` — what the package is, when to reach for it, and the four moving parts (channel registry, defineNotification, notify, inApp). Multi-channel dispatch: define once, fire anywhere. Recipients are cascade `Model` instances; payloads are typed per channel via a declaration-merge `NotificationChannels` registry; reusable definitions go through `defineNotification`; ad-hoc per-channel sends go through the `notify.<channel>` proxy; the in-app database channel is read via the `inApp` facade. Phase 1 ships `mail` + `database`; bridges-backed channels (whatsapp/telegram/push/slack) arrive in Phase 2. Triggers: `defineNotification`, `notify.<channel>`, `inApp.configure`, `setNotificationConfig`, `NotificationConfig`, `NotificationChannels`; "send a notification", "in-app notifications", "what channels can I use", "what is `@warlock.js/notifications`", "where do I start"; typical import `import { defineNotification, notify, inApp } from "@warlock.js/notifications"`. Skip: configuring channels in `config/notifications.ts` — `@warlock.js/notifications/configure-notifications/SKILL.md`; building a multi-channel definition — `@warlock.js/notifications/define-notification/SKILL.md`; reading in-app rows — `@warlock.js/notifications/use-in-app/SKILL.md`.'
---

# `@warlock.js/notifications` — basics

Multi-channel notifications for Warlock.js. **Define once, fire anywhere.**

## What the package is for

You have an event (`order.shipped`, `comment.mentioned`, `password.changed`) and one or more recipients. You want to address them through any combination of channels (mail, in-app, push, ...) with one render. That's what this package is.

It is NOT a queue, a template engine, a transport library, or an analytics pipeline — it orchestrates *over* the transports cascade / core / herald / bridges already provide.

## Server-only package

`@warlock.js/notifications`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. This is build-boundary metadata read by `@warlock.js/web`'s Gate A (import resolution) and Gate C (emitted-bundle verification), not application behavior. App code that reaches the client bundle (including page and layout modules) must not value-import `@warlock.js/notifications` — Gate A refuses the build. A type-only import (`import type { ... }`) is allowed. Server loaders, controllers, and modules may import it freely.

## Four moving parts

1. **`NotificationChannels`** — a TypeScript interface (declaration-merge target) mapping channel name → payload type. Drives `notify.<channel>` typing and `defineNotification` renderers.
2. **`defineNotification`** — reusable multi-channel notification. Pass a `type`, a `via`, and a renderer per channel. Returns `{ send, queue, only }`.
3. **`notify`** — Proxy facade for ad-hoc single-channel sends. `notify.<channel>(to, payload, options?)` works for any registered channel.
4. **`inApp`** — facade for the database channel's read side. `inApp.configure({ model })` in the config returns the channel; `inApp.listUnread` / `markAsRead` / `markAsUnread` are the read API.

## Minimal end-to-end

`npx warlock add notifications` ejects the config + model + migration. The config is **declarative** — the notifications connector registers its default export at boot, so you never call `setNotificationConfig` yourself.

```ts title="src/config/notifications.ts"
import { type NotificationConfig, mailChannel, inApp } from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

const config: NotificationConfig = {
  channels: {
    mail:     mailChannel({ from: "no-reply@store.com" }),
    database: inApp.configure({ model: Notification }),
  },
};

export default config;
```

```ts title="src/app/orders/notifications/order-shipped.ts"
import { defineNotification } from "@warlock.js/notifications";

export const orderShipped = defineNotification<{ orderId: string; number: string }>({
  type: "order.shipped",
  via: ["database", "mail"],
  database: ({ orderId, number }) => ({
    title: `Order #${number} shipped`,
    payload: { orderId },
  }),
  mail: ({ number }, to) => ({
    subject: `Order #${number} shipped`,
    html: `<p>Hi ${to.get("name")}, on the way.</p>`,
  }),
});
```

```ts title="anywhere"
import { notify, inApp } from "@warlock.js/notifications";
import { orderShipped } from "app/orders/notifications/order-shipped";

await orderShipped.send(user, { orderId: order.id, number: order.number });
await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });

const unread = await inApp.listUnread(user);
const badge  = await inApp.countUnread(user);
await inApp.markAsRead(user, "ntf_123");
```

## Recipient = cascade `Model` instance

`Notifiable` is typed as `Model`, so any cascade model is a valid recipient — `.id` (number | string) and `.get(path)` come for free. Routing is a **channel concern**, not a model concern — channels resolve `notifiable.email` / `.phone` / `.id` / etc. by convention (overridable in channel config).

## Phase 1 vs Phase 2

| Channel | Phase | How |
|---|---|---|
| `mail` | 1 ✅ | core `sendMail` |
| `database` | 1 ✅ | cascade repo (recipient-scoped reads) |
| `whatsapp` | 2 | bridges `MessageProvider` |
| `telegram` | 2 | bridges `MessageProvider` |
| `slack` | 2 | bridges `MessageProvider` |
| `push` | 2 | bridges `PushProvider` |
| your own | 1 ✅ | `defineChannel` + 3-line `declare module` |

## See also

- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — wire `config/notifications.ts`.
- [`define-notification/SKILL.md`](../define-notification/SKILL.md) — reusable multi-channel definitions.
- [`send-ad-hoc/SKILL.md`](../send-ad-hoc/SKILL.md) — `notify.<channel>` shorthand.
- [`use-in-app/SKILL.md`](../use-in-app/SKILL.md) — `inApp` read API.
- [`define-channel/SKILL.md`](../define-channel/SKILL.md) — custom channels.
- [`write-notification-migration/SKILL.md`](../write-notification-migration/SKILL.md) — columnMap-driven columns.
- [`observe-notifications/SKILL.md`](../observe-notifications/SKILL.md) — events + metrics.
