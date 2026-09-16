---
name: queue-notifications
description: 'Send `@warlock.js/notifications` `.queue()` deliveries through BullMQ with `queueNotificationDispatcher({ queue?, attempts?, backoff? })` from `@warlock.js/queue/notifications` — put it in the `queue` slot of `src/config/notifications.ts`; the queue workers deliver. Honours `SendOptions.delay` (number = seconds, or "10m"), retries a failing `channel.send`, and fails at once for a channel missing from the worker config. Notifications keeps no queue dependency. Triggers: `queueNotificationDispatcher`, `@warlock.js/queue/notifications`, `NotificationConfig.queue`; "queue notifications with BullMQ", "retry notification delivery", "delayed notification". Skip: the herald backend — `@warlock.js/notifications/queue-notifications/SKILL.md`.'
---

# Queue notifications with BullMQ

```ts title="src/config/notifications.ts"
import { type NotificationConfig, mailChannel } from "@warlock.js/notifications";
import { queueNotificationDispatcher } from "@warlock.js/queue/notifications";

const config: NotificationConfig = {
  channels: { mail: mailChannel() },
  queue: queueNotificationDispatcher({ attempts: 3, backoff: { type: "exponential", delay: 5000 } }),
};

export default config;
```

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
