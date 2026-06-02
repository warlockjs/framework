---
title: "Dead-letter queue"
description: Production-shaped DLQ wiring with herald — channel config, retry policy, DLQ consumer for alerting, and replay tooling.
sidebar:
  order: 1
  label: "Dead-letter queue"
---

A dead-letter queue catches messages that couldn't be processed after retries. Without one, failures either loop forever in the main queue or silently disappear. With one, you get a parking lot for human review, an obvious metric to alarm on (DLQ depth), and a replay path once you've fixed the underlying bug.

This recipe walks through wiring a DLQ end to end: main channel, retry policy, DLQ consumer, and a replay script.

## The setup

Three channels are involved:

- **`user.created`** — the main work channel.
- **`user.created.failed`** — the DLQ. Same shape, different name.
- (Optional) **`user.created.replay`** — a separate queue used by the replay tool to put messages back. Helps distinguish original traffic from replays in metrics.

## Main consumer with retry + DLQ

```ts
import { connectToBroker, herald } from "@warlock.js/herald";

type UserPayload = { userId: number; email: string };

await connectToBroker({ driver: "rabbitmq", host: process.env.RABBITMQ_HOST });

await herald()
  .channel<UserPayload>("user.created")
  .subscribe(async (message, ctx) => {
    await sendWelcomeEmail(message.payload.email);
    // Throw on failure — let smart-nack route through retry → DLQ
  }, {
    prefetch: 10,
    retry: {
      maxRetries: 3,   // redelivery ceiling on throw; delay is inert here (see note)
      delay: 0,
    },
    deadLetter: {
      channel: "user.created.failed",
      preserveOriginal: true,
    },
  });
```

What this does:

- First failure → herald nacks with requeue, broker redelivers (immediately — `retry.delay` is not applied on the throw path; for spaced retries call `ctx.retry(ms)` from the handler instead).
- After 3 attempts (the configured ceiling) → herald sends the message to `user.created.failed` with original payload + metadata + `retryCount` preserved.
- The original message is acked away from `user.created` — the queue isn't blocked by poison messages.

## DLQ consumer for alerting

Subscribe to the DLQ in a separate process (or at least a separate handler). Its job: alert humans, never silently drop:

```ts
herald()
  .channel<UserPayload>("user.created.failed")
  .subscribe(async (message, ctx) => {
    await alerts.notify({
      severity: "warning",
      title: "user.created — permanent failure",
      payload: message.payload,
      retryCount: message.metadata.retryCount,
      originalChannel: message.metadata.originalChannel,
      messageId: message.metadata.messageId,
      occurredAt: message.metadata.timestamp,
    });

    // Persist a copy for human review
    await db.failedMessages.create({
      channel: message.metadata.originalChannel,
      payload: message.payload,
      metadata: message.metadata,
      receivedAt: new Date(),
      status: "pending-review",
    });

    await ctx.ack();
  });
```

Two things worth noting:

- **Always ack the DLQ message** once you've recorded it. Otherwise you've created a DLQ-for-the-DLQ situation — messages pile up in `user.created.failed` waiting for an ack that never comes.
- **Don't process the failed payload here.** This handler exists to record and alert. The real retry happens in the replay step below, where a human or scheduled job decides whether the underlying bug is fixed.

## DLQ depth monitoring

The fastest signal for "something is broken" is DLQ growth. Hook `channel.stats()` into your metrics collector:

```ts
import { herald } from "@warlock.js/herald";

setInterval(async () => {
  const stats = await herald().channel("user.created.failed").stats();
  metrics.gauge("herald.dlq.depth", stats.messageCount, {
    channel: "user.created.failed",
  });

  if (stats.messageCount > 100) {
    await alerts.critical(`DLQ depth: ${stats.messageCount}`);
  }
}, 30_000);
```

Set the threshold based on your baseline. Zero growth is the goal; sustained growth means real failures.

## Replay tool

Once you've fixed the bug, replay the parked messages back into the main queue:

```ts title="scripts/replay-dlq.ts"
import { connectToBroker, herald } from "@warlock.js/herald";

await connectToBroker({ driver: "rabbitmq", host: process.env.RABBITMQ_HOST });

const dlq = herald().channel("user.created.failed");
const main = herald().channel("user.created");

const before = await dlq.stats();
console.log(`Replaying ${before.messageCount} messages...`);

let replayed = 0;

await dlq.subscribe(async (message, ctx) => {
  // Republish to the main channel, with a header marking it as a replay
  await main.publish(message.payload, {
    headers: {
      ...message.metadata.headers,
      "x-replayed-from": "user.created.failed",
      "x-replayed-at": new Date().toISOString(),
    },
    persistent: true,
  });

  await ctx.ack();
  replayed += 1;

  if (replayed >= before.messageCount) {
    console.log(`Done — replayed ${replayed} messages`);
    process.exit(0);
  }
});
```

The `x-replayed-from` header lets the main consumer log replays separately from organic traffic — useful for tracking which deployment finally fixed the underlying bug.

## Things to know

- **`preserveOriginal: true`** is what keeps the original payload + metadata intact in the DLQ envelope. Without it you only get the metadata.
- **DLQ messages can themselves fail and DLQ.** Don't configure `deadLetter` on the DLQ subscriber — that creates an infinite chain. If the DLQ handler itself crashes, you want it to nack-and-requeue so the next attempt has a fresh chance.
- **Today's DLQ is herald-managed.** The driver re-publishes to the DLQ channel on retry exhaustion; AMQP's native `x-dead-letter-exchange` semantics (different exchange routing, TTL-on-DLQ) aren't surfaced. If you need those, drop to the raw AMQP channel via `broker.driver.getRawChannel()`.
- **One DLQ per channel is the simple model.** A "global DLQ for everything" sounds tidy but loses the channel context. Use `metadata.originalChannel` if you must route from a fan-in DLQ to per-channel handlers.

## See also

- [Handle errors and retries](../guides/handle-errors-and-retries.md) — when to retry vs reject.
- [Consume messages](../guides/consume-message.md) — full subscribe + ctx reference.
