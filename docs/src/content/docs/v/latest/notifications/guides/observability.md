---
title: "Observability"
description: Subscribe to sending / sent / failed / skipped events — with a shared dispatchId + durationMs — for metrics, logging, tracing, and drop accounting.
sidebar:
  label: "Observability"
---

Every dispatch emits a `sending` event then a terminal `sent` / `failed` — or a `skipped` if a gate dropped it — per (channel, recipient). Subscribe for metrics, logs, traces, and audits:

```ts
import { notifications } from "@warlock.js/notifications";

// latency + delivery, keyed by recipient
notifications.on("sent", ({ channel, notifiable, durationMs, options }) =>
  metrics.timing(`notif.${channel}.sent`, durationMs, { userId: notifiable?.id, ...options.meta }));

notifications.on("failed", ({ channel, notifiable, error }) =>
  log.error(`notif.${channel}`, error, { userId: notifiable?.id }));

notifications.on("skipped", ({ channel, reason }) =>
  metrics.inc(`notif.${channel}.skipped.${reason}`));

// pair `sending` → terminal by dispatchId — open a span, or arm a hung-send watchdog
notifications.on("sending", ({ dispatchId, channel, notifiable }) =>
  tracer.open(dispatchId, { channel, userId: notifiable?.id }));
```

## The events

| Event | Fires when | Payload |
| --- | --- | --- |
| `sending` | gates passed; about to hit the transport (or enqueue) | `{ dispatchId, channel, notifiable?, payload, options }` |
| `sent` | a channel dispatched (or a job enqueued) | `{ dispatchId, channel, notifiable?, payload, options, durationMs }` |
| `failed` | a channel's `send` threw | `{ dispatchId, channel, notifiable?, payload, error, options, durationMs }` |
| `skipped` | a gate dropped the channel | `{ dispatchId, channel, notifiable?, reason, options }` — `reason: "preference" \| "rate-limit"` |

`notifiable` is the recipient **model** (`undefined` only for raw-target ad-hoc sends) — read `notifiable?.id` / `notifiable?.get(...)` to key your metrics and logs.

`dispatchId` is unique per (channel, recipient) dispatch: `sending` and its terminal `sent`/`failed` share it, so you can pair them for a span, a latency measurement, or a watchdog that flags a `sending` with no terminal (a hung send). `durationMs` is transport time on a synchronous send, enqueue time on a queued one.

`options.meta` carries whatever you tagged the send with — join events back to a campaign or request:

```ts
await campaign.queue(user, data, { meta: { campaignId: "spring-2026" } });
notifications.on("sent", ({ options }) => track(options.meta?.campaignId));
```

## Fan-out → N events

`orderShipped.send([a, b], data)` over `via: ["mail", "database"]` emits up to 4 `sent` events (2 recipients × 2 channels). Aggregate by `channel` + `notifiable.id` or by `meta`.

## Unsubscribe + isolation

`on(...)` returns an unsubscribe function; `off(event, handler)` also works. A handler that throws is logged and swallowed — one bad listener never breaks dispatch. Observers can't **abort** a send (use `preferences` / `rateLimit` for that), but `sending` is awaited before the transport, so a slow `sending` handler delays it — keep it fast.

```ts
const off = notifications.on("failed", alertOnCall);
// later
off();
```

## Next

- [Preferences & rate limits](./preferences-and-rate-limits.md) — what produces `skipped`.
- [API reference](../reference/api.md) — the full event payload types.
