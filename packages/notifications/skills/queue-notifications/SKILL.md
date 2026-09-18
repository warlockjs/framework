---
name: queue-notifications
description: "Send notifications asynchronously through the herald backend or the BullMQ driver. Configure a QueueDispatcher in config/notifications.ts, then use notif.queue(to, data, options?) to enqueue rendered jobs. Herald uses heraldQueue() and startNotificationsWorker(); bullmqQueue({ attempts, backoff }) from @warlock.js/notifications uses BullMQ (lazy-loading the optional @warlock.js/queue peer), supports retries, and honours SendOptions.delay. Without a queue configured, .queue() rejects NoQueueDispatcherError. Triggers: heraldQueue, bullmqQueue, startNotificationsWorker, QueueDispatcher, .queue(, async notifications, queue notifications, notification worker, background notifications, notifications.dispatch. Skip: synchronous sends - @warlock.js/notifications/define-notification/SKILL.md; herald itself - @warlock.js/herald/*."
---

# Queue notifications (async)

Move slow channels (SMTP, HTTP) off the request path. `.queue()` renders the
payload and resolves the route before passing a serializable job to a dispatcher.

## Wire the herald dispatcher

```ts title="src/config/notifications.ts"
import {
  type NotificationConfig,
  heraldQueue,
  inApp,
  mailChannel,
} from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

const config: NotificationConfig = {
  channels: { mail: mailChannel(), database: inApp.configure({ model: Notification }) },
  queue: heraldQueue(),
};

export default config;
```

`heraldQueue({ channel?, broker? })` publishes to `"notifications.dispatch"`
on the default broker unless overridden. It lazy-imports `@warlock.js/herald`;
if that package is missing, the first `.queue()` throws an install message.

## Use BullMQ for delayed or retried delivery

Use the `bullmq` driver instead of the herald dispatcher — it ships inside
`@warlock.js/notifications` itself and lazy-loads `@warlock.js/queue` (an
OPTIONAL peer) the first time `.queue()` runs:

```ts title="src/config/notifications.ts"
import { type NotificationConfig, bullmqQueue, mailChannel } from "@warlock.js/notifications";

const config: NotificationConfig = {
  channels: { mail: mailChannel() },
  queue: bullmqQueue({ attempts: 3, backoff: { type: "exponential", delay: 5000 } }),
};

export default config;
```

The BullMQ driver honours `SendOptions.delay`: numeric delays are seconds and
string delays use the normal duration syntax, such as `"10m"`. It also supports
BullMQ retries through `attempts` and `backoff`. If `@warlock.js/queue` isn't
installed, the first `.queue()` throws `QueuePackageNotInstalledError` naming
`warlock add queue`.

> **Removed (5.15.0):** `queueNotificationDispatcher` from
> `@warlock.js/queue/notifications` — deprecated in 5.14, removed this
> release, along with the `@warlock.js/notifications` peer dependency it was
> the only reason `@warlock.js/queue` carried. Use `bullmqQueue` above — same
> option names (`queue`, `attempts`, `backoff`).

## Run the herald worker

In a worker entrypoint (or the web process), after the config and herald broker
are up:

```ts
import { startNotificationsWorker } from "@warlock.js/notifications";

await startNotificationsWorker();
```

The worker looks up the channel by name and runs
`channel.send({ payload, route, options })`. The worker needs no recipient model
because rendering happened at enqueue time.

## Send

```ts
await orderShipped.queue(user, { order });
await orderShipped.queue(buyers, { order }, { delay: "10m" });
await notify.mail(user, payload, {/* synchronous - notify.* does not queue */});
```

`.queue()` renders per recipient and enqueues one job per recipient. Without a
configured dispatcher, it rejects `NoQueueDispatcherError`.

## Idempotency

Pass `idempotencyKey` so a redelivered or retried job does not create a duplicate
in-app row. `createFor` finds or creates the row by that key.

```ts
await orderShipped.queue(user, { order }, { idempotencyKey: `ship:${order.id}` });
```

## Current limits

- With the herald backend, `delay` is carried on the job but not honoured; the
  worker delivers immediately. Use the BullMQ adapter for delayed delivery.
- Herald has no retry or dead-letter handling yet; failed `channel.send` calls
  are logged and acknowledged.
- Rate-limit budget is consumed at enqueue time for queued sends.

## See also

- [`define-notification/SKILL.md`](../define-notification/SKILL.md) - `.queue()` on a defined notification.
- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) - the `queue` config slot.
- [`@warlock.js/herald/herald-basics/SKILL.md`](../../../herald/skills/herald-basics/SKILL.md) - connecting the broker.
