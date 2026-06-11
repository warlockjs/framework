---
name: queue-notifications
description: 'Send notifications asynchronously via the herald-backed queue. `heraldQueue({ channel?, broker? })` is a `QueueDispatcher` you pass to `setNotificationConfig({ queue })`; then `notif.queue(to, data, options?)` / `notify` publish a rendered job instead of sending inline. `startNotificationsWorker({ channel?, broker? })` runs the consumer (in a worker or the web process) that pulls jobs and runs `channel.send`. Both lazy-import `@warlock.js/herald` (optional peer) — a missing package throws a curated install message at use time. `defineNotification` renders payloads + resolves routes BEFORE queuing, so the job (`{ channel, route, payload, options }`) is fully serializable — no model re-hydration. Without a queue configured, `.queue()` rejects `NoQueueDispatcherError`. Triggers: `heraldQueue`, `startNotificationsWorker`, `QueueDispatcher`, `.queue(`, "async notifications", "queue notifications", "notification worker", "background notifications", `notifications.dispatch`; typical import `import { heraldQueue, startNotificationsWorker } from "@warlock.js/notifications"`. Skip: synchronous sends — `@warlock.js/notifications/define-notification/SKILL.md`; herald itself — `@warlock.js/herald/*`.'
---

# Queue notifications (async)

Move slow channels (SMTP, HTTP) off the request path. `.queue()` publishes a
rendered job to herald; a worker delivers it.

## Wire the dispatcher

```ts title="src/config/notifications.ts"
import { setNotificationConfig, heraldQueue, inApp, mailChannel } from "@warlock.js/notifications";

setNotificationConfig({
  channels: { mail: mailChannel(), database: inApp.configure({ model: Notification }) },
  queue: heraldQueue(), // → `.queue()` now works
});
```

`heraldQueue({ channel?, broker? })` publishes to `"notifications.dispatch"` on
the default broker unless overridden. It lazy-imports `@warlock.js/herald`; if
that package isn't installed, the first `.queue()` throws an install message.

Without `queue` configured, `.queue()` rejects `NoQueueDispatcherError` — a loud
config error, not a silent no-op.

## Run the worker

In a worker entrypoint (or the web process), after the config + the herald
broker are up:

```ts
import { startNotificationsWorker } from "@warlock.js/notifications";

await startNotificationsWorker(); // subscribes to "notifications.dispatch"
```

The worker pulls each job, looks the channel up by name, and runs
`channel.send({ payload, route, options })`. The job carries an
ALREADY-RENDERED payload + resolved route (rendering happens at enqueue), so the
worker needs no recipient model.

## Send

```ts
await orderShipped.queue(user, { order });               // async
await orderShipped.queue(buyers, { order }, { delay: "10m" });
await notify.mail(user, payload, { /* sync — notify.* doesn't queue */ });
```

`.queue()` renders synchronously then enqueues. Fan-out renders per recipient
and enqueues one job each.

## Idempotency

Pass `idempotencyKey` so a redelivered/retried job doesn't create a duplicate
in-app row — `createFor` find-or-creates on the key.

```ts
await orderShipped.queue(user, { order }, { idempotencyKey: `ship:${order.id}` });
```

## Phase notes / current limits

- **`delay` is carried on the job but not yet honored** — the worker delivers
  immediately. Delay-aware delivery lands with a scheduled worker.
- **No retry / dead-letter yet** — a failed `channel.send` is logged + acked
  (no poison-message loop). DLQ handling is a follow-up.
- Rate-limit budget is consumed at ENQUEUE time for queued sends (see
  `RateLimiter` docstring).

## See also

- [`define-notification/SKILL.md`](../define-notification/SKILL.md) — `.queue()` on a defined notification.
- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — the `queue` config slot.
- [`@warlock.js/herald/herald-basics/SKILL.md`](../../../herald/skills/herald-basics/SKILL.md) — connecting the broker.
