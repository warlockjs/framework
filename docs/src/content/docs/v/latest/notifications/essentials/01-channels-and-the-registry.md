---
title: "Channels & the registry"
description: How channels render, resolve a recipient's address, and how the typed NotificationChannels registry powers notify.<channel>.
sidebar:
  order: 1
  label: "Channels & the registry"
---

A **channel** is one transport with two jobs: resolve *where* to reach a recipient, and *send* a rendered payload there.

```ts
interface Channel<P> {
  name: string;
  route?(notifiable): string | { id } | undefined; // the address
  send(ctx: { payload: P; route; notifiable?; options }): Promise<void>;
}
```

## The registry — `NotificationChannels`

Every channel name maps to a payload type in one interface:

```ts
interface NotificationChannels {
  mail: { subject: string; html?: string; text?: string; cc?: string | string[] };
  database: DatabasePayload;
}
```

This single interface is the **declaration-merge target** that makes everything type-safe:

- `notify.mail(user, payload)` — `payload` is checked against `NotificationChannels["mail"]`.
- `defineNotification({ via, mail, database })` — each renderer's return type is checked.

A custom channel extends it with three lines, and instantly gets the same typing:

```ts
declare module "@warlock.js/notifications" {
  interface NotificationChannels {
    discord: { content: string };
  }
}
// → notify.discord(user, { content: "🎉" }) is now typed
```

## Routing — a channel concern, not a model concern

There is no `routeNotificationFor` on your model. Each channel resolves the recipient's address itself, by convention, overridable in config:

| Channel | Default route | Override |
| --- | --- | --- |
| `mail` | `notifiable.get("email")` | `mailChannel({ route: (n) => n.get("workEmail") })` |
| `database` | `{ id: notifiable.id }` | — (always the id) |
| custom | whatever your `route()` returns | in the factory |

Recipients are cascade `Model` instances — `.id` and `.get(path)` come for free. Pass a raw string instead of a model for a one-off target:

```ts
await notify.mail("guest@example.com", { subject: "Receipt", html: "…" });
```

### When a route can't be resolved

If a channel **declares** a `route()` resolver and it returns `undefined` (e.g. a mail recipient with no email), the dispatch throws `UnresolvableRouteError` — it will not silently coerce to `{ id }` and hand a string-route channel an object. Only channels that declare **no** resolver fall back to `{ id }`.

## Built-in vs custom

| Channel | Status | Backed by |
| --- | --- | --- |
| `mail` | shipped | core `sendMail` |
| `database` | shipped | cascade repository |
| `whatsapp` / `telegram` / `slack` / `push` | with `@warlock.js/bridges` | bridge providers |
| anything else | `defineChannel` | your `send()` |

Until bridges lands, an HTTP channel (Slack/Discord/internal webhook) is a 30-line [`defineChannel`](../guides/custom-channels.md).

## Next

- [The in-app store](./02-the-in-app-store.md) — the `database` channel's read side.
- [Define a notification](../guides/define-notification.md) — render across channels.
- [Custom channels](../guides/custom-channels.md) — add your own.
