---
title: "Handle errors and retries"
description: Production patterns for transient vs permanent failures — ctx.retry vs ctx.reject, retry policy, dead-letter queues, and connection-level errors.
sidebar:
  order: 4
  label: "Handle errors and retries"
---

Failure handling in herald is layered. There's "this one message failed" (handler-level), "this consumer keeps crashing" (subscription-level), and "the broker is gone" (connection-level). Each layer has the right knob.

## Classify the failure first

Before reaching for retries or DLQs, decide what kind of failure you're handling:

| Failure | Example | Right move |
| --- | --- | --- |
| **Transient — same attempt, immediate retry** | Network blip during DB write | `ctx.nack(true)` — requeue, broker redelivers |
| **Transient — with backoff** | Rate-limited by an upstream API | `ctx.retry(2000)` — wait then retry |
| **Permanent — bad input** | Email field malformed | `ctx.reject()` — DLQ, don't requeue |
| **Permanent — code bug** | TypeError in handler | Throw — let `retry` + `deadLetter` handle it |
| **Poison message — keeps failing forever** | Edge case the handler doesn't cover | DLQ after `maxRetries`, alert on DLQ depth |

The mistake is treating every failure as a retry. A bad payload that violates a schema isn't a retry — it'll fail forever and clog the queue. Reject it.

## Handler-level patterns

### Transient, immediate retry

```ts
await channel.subscribe(async (message, ctx) => {
  try {
    await db.transaction(async () => {
      await persistOrder(message.payload);
    });
    await ctx.ack();
  } catch (error) {
    if (isTransient(error)) {
      await ctx.nack(true);   // back on the queue, broker redelivers
    } else {
      throw error;            // let smart-nack handle it
    }
  }
});
```

### Transient with backoff

```ts
await channel.subscribe(async (message, ctx) => {
  try {
    await callRateLimitedAPI(message.payload);
    await ctx.ack();
  } catch (error) {
    if (error.status === 429) {
      const retryAfter = Number(error.headers["retry-after"]) * 1000;
      await ctx.retry(retryAfter);
      return;
    }

    throw error;
  }
}, {
  retry: { maxRetries: 5, delay: 1000 },
  deadLetter: { channel: "api.failed" },
});
```

`ctx.retry(delayMs)` republishes the message with `x-retry-count` (and `x-delay` if the broker has the delayed-message plugin) and acks the original. After `maxRetries`, it goes to the configured DLQ — or is dropped if no DLQ is set.

### Permanent failure — bad payload

```ts
await channel.subscribe(async (message, ctx) => {
  if (!isValidShape(message.payload)) {
    await ctx.reject();     // straight to DLQ — don't requeue
    return;
  }

  await process(message.payload);
  await ctx.ack();
}, {
  deadLetter: { channel: "user.created.failed" },
});
```

For schema-shaped validation, push it into `ChannelOptions.schema` instead — the consumer-side validation runs automatically before your handler. Invalid messages get nacked-without-requeue (which sends them to DLQ if configured).

```ts
const channel = herald().channel("user.created", {
  schema: userSchema,
  deadLetter: { channel: "user.created.failed" },
});
```

## Subscription-level retry

```ts
await channel.subscribe(handler, {
  retry: {
    maxRetries: 3,
    delay: 1000,
  },
  deadLetter: {
    channel: "user.created.failed",
    preserveOriginal: true,
  },
});
```

The type signature accepts either a number or `(attempt) => number`:

```ts
type RetryOptions = {
  maxRetries: number;
  delay: number | ((attempt: number) => number);
};
```

But be clear-eyed about what `delay` does today: **on the automatic throw path it does nothing.** When a handler throws, herald only consults `maxRetries` to decide requeue-vs-DLQ; the requeue is immediate, with no wait, regardless of what `delay` is set to. The `delay` value (number or function) is never read there.

The one place a wait happens is the explicit `ctx.retry(delayMs)` call — it republishes with an `x-delay` header carrying the `delayMs` you pass. And even that only delays if the broker has the [delayed-message exchange plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange) installed; without it the retry is immediate.

So for real backoff, drive it from the handler and pass the figure yourself:

```ts
await channel.subscribe(async (message, ctx) => {
  try {
    await doWork(message.payload);
    await ctx.ack();
  } catch (error) {
    const attempt = (message.metadata.retryCount ?? 0) + 1;
    await ctx.retry(Math.min(2 ** attempt * 100, 30_000));   // capped exponential
  }
}, {
  retry: { maxRetries: 5, delay: 0 },   // delay here is inert; maxRetries is the ceiling that matters
  deadLetter: { channel: "user.created.failed" },
});
```

## Dead-letter queues

After `maxRetries`, herald sends the message to `deadLetter.channel` with the original payload (and metadata if `preserveOriginal: true`). Subscribe to the DLQ separately for alerting and replay:

```ts
herald()
  .channel("user.created.failed")
  .subscribe(async (message, ctx) => {
    await alerts.notify({
      event: "user.created.permanently-failed",
      payload: message.payload,
      originalChannel: message.metadata.originalChannel,
      retries: message.metadata.retryCount,
    });
    await ctx.ack();
  });
```

See the [dead-letter-queue recipe](../recipes/dead-letter-queue.md) for an end-to-end pattern including replay tooling.

## Idempotent consumers

Retries mean the same message can run twice — the broker redelivers, your handler retries, even successful work can be redelivered if your ack didn't make it back. **Design every consumer to be safe to run twice.**

Cheap idempotency: stash the `messageId` in a processed-messages table inside the same transaction as the side effect:

```ts
await channel.subscribe(async (message, ctx) => {
  const wasProcessed = await db.processedMessages.exists(message.metadata.messageId);

  if (wasProcessed) {
    await ctx.ack();   // dedup — skip, but ack so broker stops redelivering
    return;
  }

  await db.transaction(async () => {
    await sendWelcomeEmail(message.payload.email);
    await db.processedMessages.insert({ messageId: message.metadata.messageId });
  });

  await ctx.ack();
});
```

If the work is naturally idempotent (UPSERT-style writes, "set this state to X"), you might not need the table. But always think about it before assuming exactly-once delivery — neither herald nor RabbitMQ gives you that out of the box.

## Connection-level errors

Connection failures are different from message failures. They're handled by the driver, not by your handler:

- **Broker restart** — heartbeat detects dead socket, driver emits `disconnected`, then reconnect loop starts (every `reconnectDelay` ms — default 5s).
- **Reconnect success** — driver emits `connected`, re-subscribes any pending consumers, resumes publishing.
- **Publish during outage** — `channel.publish` throws (the underlying AMQP channel is closed). Catch it in your producer code:

```ts
try {
  await herald().channel("user.created").publish(payload);
} catch (error) {
  // Broker down. Persist to outbox, alert ops, drop the message — your call.
  await outbox.enqueue("user.created", payload);
}
```

Subscribe to lifecycle events for alerting:

```ts
import { brokerRegistry } from "@warlock.js/herald";

brokerRegistry.on("disconnected", (broker) => {
  alerts.warning(`Broker ${broker.name} disconnected`);
});

const broker = await connectToBroker({ /* ... */ });

broker.driver.on("reconnecting", (attempt) => {
  console.log(`Reconnect #${attempt}`);
  if (attempt > 10) {
    alerts.critical(`Herald has retried ${attempt} times`);
  }
});
```

## Health checks

`broker.healthCheck()` round-trips a no-op against the broker and reports liveness + latency:

```ts
const health = await broker.healthCheck();

if (!health.healthy) {
  // Mark this app instance unhealthy in your orchestrator
  console.error(health.error);
}
```

Wire it into your `/health` endpoint:

```ts
app.get("/health", async (req, res) => {
  const checks = await Promise.all(
    brokerRegistry.getAll().map((broker) => broker.healthCheck()),
  );

  const allHealthy = checks.every((check) => check.healthy);
  res.status(allHealthy ? 200 : 503).json({ checks });
});
```

## Things NOT to do

- **Don't swallow errors and ack.** That's silently dropping work. If you can't handle it, reject or DLQ.
- **Don't retry without a `maxRetries` ceiling.** A poison message ping-pongs forever, blocks the queue.
- **Don't run with no DLQ in production.** Failures pile up invisibly. At minimum, configure DLQ and monitor depth.
- **Don't assume exactly-once delivery.** Design idempotent handlers. Always.
- **Don't catch connection errors and silently continue.** Either persist (outbox) or alert. Lost messages are lost decisions.

## Next

- [Dead-letter queue recipe](../recipes/dead-letter-queue.md) — production-shaped DLQ wiring.
- [Consume messages](./consume-message.md) — full subscriber reference.
- [Connection and config](../essentials/02-connection-and-config.md) — reconnect tuning, graceful shutdown.
