---
name: queue-notifications
description: "Queue notifications with BullMQ in @warlock.js/queue; use when you need to queue notifications."
---

# Queue notifications with BullMQ

```ts title="src/config/notifications.ts"
import { type NotificationConfig, bullmqQueue, mailChannel } from "@warlock.js/notifications";

const config: NotificationConfig = {
  channels: { mail: mailChannel() },
  queue: bullmqQueue({ attempts: 3, backoff: { type: "exponential", delay: 5000 } }),
};

export default config;
```

`bullmqQueue` ships inside `@warlock.js/notifications` itself and lazy-loads `@warlock.js/queue` (an OPTIONAL peer) the first time `.queue()` runs — install it with `warlock add queue` if it isn't there yet, otherwise the first `.queue()` throws `QueuePackageNotInstalledError`.

Also configure the queue itself (`configure-queue`). No separate notifications worker is needed: the delivery is an ordinary job, run by the queue workers.

```ts
await orderShipped.queue(user, { order }); // enqueued, delivered by a worker
await orderShipped.queue(user, { order }, { delay: "10m" }); // delivered in 10 minutes
```

## Behaviour

- The job carries the rendered payload and resolved route; the worker looks the channel up by name in its own notifications config and calls `channel.send`.
- `delay`: a number is seconds (notifications' convention); a string is a duration.
- `channel.send` throws → retried per `attempts` / `backoff`, then listed by `failedJobs()`.
- Channel not configured in the worker → fails at once, no retries.
- Deliveries run under the job name `warlock.notifications.deliver`.

