---
name: observe-notifications
description: 'Wire metrics, logging, tracing, and audits via `notifications.on(event, handler)` — four events fire per (channel, recipient): `sending` (gates passed, about to hit the transport), `sent` (succeeded), `failed` (channel threw — carries the Error), `skipped` (a pre-send gate dropped it — carries `reason: "preference" | "rate-limit"`). Every event carries the recipient as `notifiable?` (undefined only for raw-target ad-hoc sends) and a `dispatchId` — `sending` and its terminal `sent`/`failed` share it, so observers can pair them (spans, latency, hung-send detection). `sent`/`failed` also carry `durationMs`. Handler exceptions are logged-and-swallowed so one bad listener can not break the dispatcher. `on(...)` returns an unsubscribe function; `off(event, handler)` exists for symmetry. Triggers: `notifications.on`, `notifications.off`, `"sending"` event, `"sent"` event, `"failed"` event, `"skipped"` event, `dispatchId`, `durationMs`, `NotificationEvents`, "notification metrics", "notification latency", "trace notifications", "notification audit log", "track notification drops"; typical import `import { notifications } from "@warlock.js/notifications"`. Skip: building notifications — the `define-notification` topic; configuring the preference/rate-limit gates that produce `skipped` — the `configure-notifications` topic.'
---

# Observe notifications

Every dispatch emits a `sending` event then a terminal `sent` / `failed` — or a `skipped` if a gate dropped it — per (channel, recipient).

```ts
import { notifications } from "@warlock.js/notifications";

// latency + delivery, keyed by recipient
notifications.on("sent", ({ channel, notifiable, durationMs, options }) =>
  metrics.timing(`notif.${channel}.sent`, durationMs, { userId: notifiable?.id, ...options.meta }));

notifications.on("failed", ({ channel, notifiable, error }) =>
  log.error(`notif.${channel}`, error, { userId: notifiable?.id }));

notifications.on("skipped", ({ channel, reason }) =>
  metrics.inc(`notif.${channel}.skipped.${reason}`));

// pair `sending` → terminal by dispatchId — open a span / arm a hung-send watchdog
notifications.on("sending", ({ dispatchId, channel, notifiable }) =>
  tracer.open(dispatchId, { channel, userId: notifiable?.id }));
```

## Events

| Event | Fires when | Payload |
|---|---|---|
| `sending` | Gates passed; about to hit the transport (sync) / enqueue (queue) | `{ dispatchId, channel, notifiable?, payload, options }` |
| `sent` | Channel dispatched OR job enqueued | `{ dispatchId, channel, notifiable?, payload, options, durationMs }` |
| `failed` | `channel.send` (or `queue.dispatch`) threw | `{ dispatchId, channel, notifiable?, payload, error, options, durationMs }` |
| `skipped` | A pre-send gate dropped this channel | `{ dispatchId, channel, notifiable?, reason, options }` — `reason: "preference" \| "rate-limit"` |

`notifiable` is the recipient **model** (undefined only for raw-target ad-hoc sends like `notify.mail("x@y.com", …)`) — read `notifiable?.id` / `notifiable?.get(...)` to key your metrics or logs.

`dispatchId` is unique per (channel, recipient) dispatch — `sending` and its terminal `sent`/`failed` share it, so you can pair them for a span, a latency measurement, or a watchdog that flags a `sending` with no terminal (a hung send). `durationMs` is transport time on a sync send, enqueue time on a queued one.

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

A handler that throws is logged and swallowed — the other handlers for the same event still run, and the dispatcher never observes the throw. Observers can't **abort** a send (there's no veto here — use `preferences` / `rateLimit` for that). They can delay it, though: `sending` is awaited before the transport, so keep that handler fast.

## See also

- The `notifications-basics` topic — front door + mental model.
- The `configure-notifications` topic — `preferences` / `rateLimit` slots that emit `skipped`.
- The `send-ad-hoc` topic — when `notifiable` is undefined in events.
