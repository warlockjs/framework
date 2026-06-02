---
title: "Consume messages"
description: Subscribe to a herald channel — handler shape, flow control via ctx, prefetch, retry policy, dead-letter queues, and consumer groups.
sidebar:
  order: 2
  label: "Consume messages"
---

`channel.subscribe(handler, options?)` registers a consumer. The handler receives every message that lands on the channel along with a `ctx` object for flow control. Herald gives you smart defaults — return normally and it acks; throw and it nacks — but you usually want explicit control over what "failure" means.

## The handler shape

```ts
import { herald } from "@warlock.js/herald";

await herald()
  .channel<{ userId: number; email: string }>("user.created")
  .subscribe(async (message, ctx) => {
    try {
      await sendWelcomeEmail(message.payload.email);
      await ctx.ack();
    } catch (error) {
      await ctx.nack(true);   // requeue, broker redelivers
    }
  });
```

- `message.payload` — the typed payload.
- `message.metadata` — `messageId`, `timestamp`, `correlationId`, `headers`, `retryCount`, `originalChannel`.
- `message.raw` — the raw AMQP message (escape hatch when you need an option herald doesn't surface).
- `ctx` — flow-control object: `ack`, `nack`, `reject`, `retry`, `reply`.

The handler can be sync or async. Returning resolves the message; throwing fails it.

## Flow control via `ctx`

| Method | What it does |
| --- | --- |
| `ctx.ack()` | Success — message removed from the queue. |
| `ctx.nack(requeue?)` | Failure — `requeue: true` (default) puts it back; `false` drops it (or sends to DLQ if configured at the channel level). |
| `ctx.reject()` | Shorthand for `nack(false)` — permanent failure. |
| `ctx.retry(delayMs?)` | Republishes with a retry counter; goes to DLQ when `maxRetries` is exceeded. |
| `ctx.reply(payload)` | Sends `payload` to the requester — only meaningful for [request-and-respond](./request-and-respond.md). |

Pick by intent:

| Intent | Use |
| --- | --- |
| Processed cleanly | `ctx.ack()` |
| Transient failure, try again now | `ctx.nack(true)` |
| Transient failure, back off first | `ctx.retry(5000)` |
| Permanent failure, send to DLQ | `ctx.reject()` |
| Validation failure (bad message) | `ctx.reject()` — don't requeue, it'll loop |

## Smart auto-behavior

You don't have to call `ctx` at all. Herald watches what the handler does:

- **Handler returns normally** without touching ack/nack → herald **auto-acks**.
- **Handler throws** → herald **auto-nacks** (requeue if `retry` is configured + under `maxRetries`, otherwise DLQ if configured, otherwise reject).
- **Handler explicitly calls** ack / nack / reject / retry → herald respects the call and skips auto-handling.

The explicit-call version is usually clearer, but the auto-behavior is a safety net — a handler that forgets to ack still works, and a handler that throws gets sane error handling for free.

## Subscribe options

```ts
await channel.subscribe(handler, {
  group: "email-workers",      // consumer tag — multiple consumers in same group split work
  prefetch: 10,                 // how many in-flight messages this consumer holds
  autoAck: false,               // default; keep false in production
  exclusive: false,             // single consumer only on this channel?
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

All `SubscribeOptions`:

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `consumerId` | `string` | random UUID | Stable ID for the subscription — pass when you want to `unsubscribeById` later from elsewhere. |
| `group` | `string` | unset | AMQP `consumerTag`. Workers sharing the same `group` split messages round-robin. |
| `prefetch` | `number` | broker default | Per-consumer in-flight cap. Higher = more throughput; lower = even spread across workers. |
| `autoAck` | `boolean` | `false` | If `true`, broker acks on delivery (`noAck` in AMQP terms). Loses messages on crash. |
| `exclusive` | `boolean` | `false` | If `true`, only this consumer can read from the queue. Use sparingly. |
| `retry` | `RetryOptions` | unset | See [Retry policy](#retry-policy). |
| `deadLetter` | `DeadLetterOptions` | unset | See [Dead-letter queues](#dead-letter-queues). |

## Prefetch

`prefetch` is the per-consumer concurrency cap — the broker won't deliver a new message to this consumer until you've acked some of what it already holds.

- **CPU-bound handlers** — set ≈ CPU cores. Past that, you're queuing for the event loop.
- **IO-bound handlers** — go higher (10–100). Most of the time is spent waiting on network or disk; concurrency wins.
- **Heterogeneous** — start at 10, watch broker queue depth and handler latency, tune.

Set it on the connection (`connectToBroker({ prefetch: 10 })`) for an app-wide default, or per subscribe call to override.

:::note[One AMQP channel per broker]
Herald's RabbitMQ driver shares a single AMQP channel across every herald channel on a broker. A `prefetch` set in `subscribe` calls `amqplib`'s channel-level `prefetch`, so the latest value applies to the whole AMQP channel — it isn't isolated per consumer the way a dedicated-channel-per-consumer design would be. In practice this rarely bites (most apps run one consumer per process), but if you need strictly independent prefetch per subscriber, run them in separate processes or drop to your own channel via `broker.driver.getRawChannel()`.
:::

## Retry policy

```ts
await channel.subscribe(handler, {
  retry: {
    maxRetries: 3,
    delay: 1000,
  },
});
```

`maxRetries` is the knob that actually drives redelivery. Retry behavior depends on whether you call `ctx.retry()` or just throw:

- **Handler throws** with `retry` configured — herald inspects `x-retry-count` on the AMQP message. Under `maxRetries`, it nacks with requeue (the broker redelivers **immediately** — see the delay caveat below). At or over `maxRetries`, it nacks-without-requeue (→ DLQ if configured) or rejects outright.
- **`ctx.retry(delayMs?)`** — herald republishes the message with an incremented `x-retry-count` and (if you pass `delayMs`) an `x-delay` header, then acks the original. When `retryCount > maxRetries`, the message is sent to the configured DLQ (or acked away if no DLQ).

:::caution[`retry.delay` does not gate the throw path]
`RetryOptions.delay` (number or `(attempt) => number`) is **not consulted when a handler throws** — the automatic requeue happens with no wait. A delay only takes effect when you call `ctx.retry(delayMs)` explicitly, and even then it's emitted as an `x-delay` header that requires the [delayed-message exchange plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange); without the plugin the retry is immediate. For real backoff, call `ctx.retry(ms)` inside the handler and install the plugin.
:::

## Dead-letter queues

```ts
await channel.subscribe(handler, {
  retry: { maxRetries: 3, delay: 1000 },
  deadLetter: {
    channel: "user.created.failed",
    preserveOriginal: true,
  },
});
```

When `maxRetries` is exceeded (or you explicitly `ctx.reject()` on a channel with `deadLetter`), the message lands in the configured DLQ. Subscribe to the DLQ separately for alerting or manual replay:

```ts
herald()
  .channel("user.created.failed")
  .subscribe(async (message, ctx) => {
    await alerts.notify(
      `Permanently failed: ${JSON.stringify(message.payload)}`,
    );
    await ctx.ack();
  });
```

`preserveOriginal: true` keeps the original payload and headers in the DLQ envelope so you can replay it after fixing the bug. Without it you only get the metadata.

Today's RabbitMQ driver implements DLQ at the subscribe-options level (herald-managed redelivery to a target channel). If you need broker-native `x-dead-letter-exchange` semantics (different routing-key rewrite rules, TTL-on-DLQ, etc.), reach for the raw AMQP channel via `broker.driver.getRawChannel()` and assert your own.

See the [dead-letter-queue recipe](../recipes/dead-letter-queue.md) for an end-to-end setup.

## Consumer groups — sharing work

Point N consumers at the same channel with the same `group` value:

```ts
// Worker 1, 2, 3 — all on different machines
await herald()
  .channel("invoice.generate")
  .subscribe(handler, { group: "invoice-workers", prefetch: 5 });
```

RabbitMQ round-robins messages across the consumers on that queue. Add a worker → faster processing. Kill a worker → its in-flight messages get redelivered to siblings (because they were never acked).

**Note**: in the current RabbitMQ driver, "consumer group" maps directly onto AMQP `consumerTag`. There's no built-in fanout where every group receives every message — that requires AMQP exchanges (fanout / topic) which aren't surfaced through herald's API yet. If you need broadcast semantics, drop to the raw channel.

## EventConsumer + `@Consumable` — class-based consumers

For codebases that prefer one-class-per-event, herald ships an `EventConsumer` base class and a `@Consumable()` decorator:

```ts
import { Consumable, EventConsumer } from "@warlock.js/herald";
import { v } from "@warlock.js/seal";

type Payload = { userId: number; email: string };

@Consumable()
export class UserCreatedConsumer extends EventConsumer<Payload> {
  public static eventName = "user.created";

  public schema = v.object({
    userId: v.int(),
    email: v.string().email(),
  });

  public async handle(payload: Payload) {
    await sendWelcomeEmail(payload.email);
  }
}
```

What this gets you:

- `eventName` is the channel name — module-level discoverability.
- `schema` runs before `handle` — invalid payloads are nacked without your handler ever seeing them.
- `@Consumable()` registers the class with the broker; if the broker is connected at decoration time, it subscribes immediately. If not, it queues until `connectToBroker` fires. Pass `@Consumable({ broker: "analytics" })` to subscribe to a non-default broker.
- The class can opt into version filtering via static `minVersion` / `maxVersion` — messages outside that range are acked without processing (silently skipped). Useful for rolling upgrades.

There's also a `defineConsumer` factory if you don't want a full class:

```ts
import { defineConsumer } from "@warlock.js/herald";

defineConsumer<Payload>("user.created", {
  schema: userSchema,
  handle: async (payload) => {
    await sendWelcomeEmail(payload.email);
  },
});
```

It registers itself the same way `@Consumable()` does — call it once at module import and you're set up.

The companion on the publish side is `EventMessage` + `defineEvent` + `publishEvent` — see [publish-message](./publish-message.md) once that section is fleshed out, or read the source at `@warlock.js/herald/src/message-managers/event-message.ts` for the full shape.

## Stop a subscription

`channel.subscribe` returns a `Subscription` handle:

```ts
const subscription = await channel.subscribe(handler);

await subscription.unsubscribe();   // cancel consumer, drain in-flight
await subscription.pause();          // also cancels (no native pause in RabbitMQ)
// subscription.resume()             // throws — re-subscribe instead
```

For graceful shutdown, prefer `broker.stopConsuming()` — it cancels every consumer on every channel at once.

## Consumer-side gotchas

- **Forgetting to ack.** Unacked messages stay in flight until the broker times out and redelivers. With prefetch active, you eventually stop receiving new work because all slots are full of pending acks.
- **`ctx.nack(true)` in an infinite loop.** A perpetually-failing handler ping-pongs the message forever unless you configure `retry.maxRetries` + a DLQ.
- **Ignoring the DLQ.** Failures pile up silently. Subscribe to the DLQ for alerting or at least monitor its depth.
- **`autoAck: true` for messages that matter.** A crash mid-handling loses the message. Reserve `autoAck: true` for "we don't care if some are lost" telemetry.
- **Catching errors and acking anyway.** Now you've silently dropped the work. Either nack-with-DLQ or fix the error.

## Next

- [Handle errors and retries](./handle-errors-and-retries.md) — patterns for transient vs permanent failures.
- [Dead-letter queue recipe](../recipes/dead-letter-queue.md) — production-shaped DLQ setup.
- [Request and respond](./request-and-respond.md) — when consumers need to reply.
