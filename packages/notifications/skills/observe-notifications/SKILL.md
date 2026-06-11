---
name: observe-notifications
description: 'Wire metrics, logging, and audits via `notifications.on(event, handler)` — three events (`sent`, `failed`, `skipped`) fire per (channel, recipient). `sent`: dispatch succeeded. `failed`: channel threw (carries the Error). `skipped`: pre-send gate dropped this channel (carries `reason: "preference" | "rate-limit"`). Handler exceptions are logged-and-swallowed so one bad listener can not break the dispatcher. `on(...)` returns an unsubscribe function; `off(event, handler)` exists for symmetry. Triggers: `notifications.on`, `notifications.off`, `"sent"` event, `"failed"` event, `"skipped"` event, `NotificationEvents`, "notification metrics", "notification audit log", "track notification drops", "track preference drops"; typical import `import { notifications } from "@warlock.js/notifications"`. Skip: building notifications — `@warlock.js/notifications/define-notification/SKILL.md`; configuring the preference/rate-limit gates that produce `skipped` — `@warlock.js/notifications/configure-notifications/SKILL.md`.'
---

# Observe notifications

Every dispatch emits one of three events per (channel, recipient).

```ts
import { notifications } from "@warlock.js/notifications";

notifications.on("sent",    ({ channel, options }) => metrics.inc(`notif.${channel}.sent`, options.meta));
notifications.on("failed",  ({ channel, error }) => log.error(`notif.${channel}`, error));
notifications.on("skipped", ({ channel, reason }) => metrics.inc(`notif.${channel}.skipped.${reason}`));
```

## Events

| Event | Fires when | Payload |
|---|---|---|
| `sent` | Channel dispatched OR job enqueued | `{ channel, notifiable?, payload, options }` |
| `failed` | `channel.send` (or `queue.dispatch`) threw | `{ channel, notifiable?, payload, error, options }` |
| `skipped` | A pre-send gate dropped this channel | `{ channel, notifiable?, reason, options }` — `reason: "preference" \| "rate-limit"` |

`notifiable` is undefined for raw-target ad-hoc sends (`notify.mail("x@y.com", …)`).

`options` is the `SendOptions` passed at the call site — including `meta`. Tagging a send with `meta: { campaignId }` lets downstream observers join the event back to the campaign.

## Unsubscribe

```ts
const off = notifications.on("sent", handler);
// later
off();

// or
notifications.off("sent", handler);
```

## Fan-out emits N events

`orderShipped.send([buyer, salesRep], { order })` with `via: ["mail", "database"]` fires up to **4** `sent` events (2 recipients × 2 channels). Aggregate by `meta` or by `channel + notifiable.id` in your observer.

## Handler isolation

A handler that throws is logged and swallowed — the other handlers for the same event still run, and the dispatcher itself never observes the throw. Don't depend on observer side-effects to "block" a send.

## See also

- [`notifications-basics/SKILL.md`](../notifications-basics/SKILL.md) — front door + mental model.
- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — `preferences` / `rateLimit` slots that emit `skipped`.
- [`send-ad-hoc/SKILL.md`](../send-ad-hoc/SKILL.md) — when `notifiable` is undefined in events.
