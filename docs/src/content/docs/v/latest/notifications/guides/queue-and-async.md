---
title: "Queue & async"
description: Send notifications off the request path with the herald-backed queue — heraldQueue + startNotificationsWorker.
sidebar:
  label: "Queue & async"
---

Slow channels (SMTP, HTTP) shouldn't block a request. Configure a queue and
`.queue()` publishes a rendered job to herald; a worker delivers it.

## Wire it

```ts title="src/config/notifications.ts"
import { type NotificationConfig, heraldQueue, inApp, mailChannel } from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

const config: NotificationConfig = {
  channels: { mail: mailChannel(), database: inApp.configure({ model: Notification }) },
  queue: heraldQueue(), // backs `.queue()`
};

export default config; // the notifications connector registers it at boot
```

`heraldQueue({ channel?, broker? })` defaults to the `"notifications.dispatch"`
channel. It lazy-imports `@warlock.js/herald` — install that package to use the
queue; without it the first `.queue()` throws a clear install message. Without
`queue` configured at all, `.queue()` rejects `NoQueueDispatcherError`.

## Run the worker

```ts
import { startNotificationsWorker } from "@warlock.js/notifications";

// after the notifications config is registered + the broker is connected
await startNotificationsWorker();
```

The worker subscribes to the channel, looks each job's channel up by name, and
runs `channel.send`. Because `defineNotification` renders the payload and
resolves the route **before** enqueuing, the job is fully serializable —
the worker needs no recipient model.

## Send

```ts
await orderShipped.queue(user, { order });
await orderShipped.queue(buyers, { order }, { delay: "10m", idempotencyKey: `ship:${order.id}` });
```

`idempotencyKey` makes a redelivered job a no-op instead of a duplicate row.

## Current limits

- `delay` is carried on the job but not yet honored — delivery is immediate
  (delay-aware delivery is a follow-up).
- A failed `channel.send` is logged and acked (no retry/dead-letter yet).
- For queued sends, the rate-limit budget is consumed at enqueue time.

## See also

- [Define a notification](./define-notification.md) — `.queue()` semantics.
- [Observability](./observability.md) — `sent` fires when a job is enqueued.
