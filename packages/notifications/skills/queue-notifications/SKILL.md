---
name: queue-notifications
description: "Send notifications asynchronously through the herald backend or the BullMQ adapter. Configure a QueueDispatcher in config/notifications.ts, then use notif.queue(to, data, options?) to enqueue rendered jobs. Herald uses heraldQueue() and startNotificationsWorker(); queueNotificationDispatcher() from @warlock.js/queue/notifications uses BullMQ, supports retries, and honours SendOptions.delay. Without a queue configured, .queue() rejects NoQueueDispatcherError. Triggers: heraldQueue, startNotificationsWorker, queueNotificationDispatcher, QueueDispatcher, .queue(, async notifications, queue notifications, notification worker, background notifications, notifications.dispatch. Skip: synchronous sends - @warlock.js/notifications/define-notification/SKILL.md; herald itself - @warlock.js/herald/*."
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

With `@warlock.js/queue` configured, use its notification dispatcher instead
of the herald dispatcher:

```ts title="src/config/notifications.ts"
import { type NotificationConfig, mailChannel } from "@warlock.js/notifications";
import { queueNotificationDispatcher } from "@warlock.js/queue/notifications";

const config: NotificationConfig = {
  channels: { mail: mailChannel() },
  queue: queueNotificationDispatcher({ attempts: 3 }),
};

export default config;
```

The BullMQ adapter honours `SendOptions.delay`: numeric delays are seconds and
string delays use the normal duration syntax, such as `"10m"`. It also supports
BullMQ retries through `attempts` and `backoff`.

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
