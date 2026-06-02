---
title: "Publish a message"
description: How to publish messages with herald — typed channels, publish options (priority, TTL, delay, headers), batching, and schema validation.
sidebar:
  order: 1
  label: "Publish a message"
---

`channel.publish(payload, options?)` is the entire producer API. The promise resolves once the broker has **accepted** the message — not once a consumer has handled it. (For "wait until handled and reply", see [request-and-respond](./request-and-respond.md).)

## The minimum

```ts
import { herald } from "@warlock.js/herald";

await herald()
  .channel("user.created")
  .publish({ userId: 1, email: "ada@example.com" });
```

Three things happen under the hood:

1. **First-access lazy assert.** If this is the first time the channel is touched, herald asserts the queue (`durable: true` by default).
2. **Envelope wrap.** Your payload gets wrapped with a `messageId`, `timestamp`, and any options you passed.
3. **`sendToQueue`.** The envelope JSON is handed to RabbitMQ on the default exchange, routed by channel name.

## Typed channels

`channel<TPayload>` constrains both publish and subscribe to the same shape — and you get inference for free:

```ts
type UserPayload = {
  userId: number;
  email: string;
};

const channel = herald().channel<UserPayload>("user.created");

await channel.publish({ userId: 1, email: "ada@example.com" });   // ✅
await channel.publish({ userId: "1" });                            // ❌ compile error
```

In a real codebase, define the payload type in a shared file (`shared/events/user.ts`) and import it from both producer and consumer. That's the contract; drift between sides causes silent payload corruption — and the schema option below catches it at the boundary.

## Schema-validated publish

Pass a `@warlock.js/seal` schema in `ChannelOptions.schema` and herald validates **before** the message hits the broker. Invalid payloads throw; they never leave the producer.

```ts
import { v } from "@warlock.js/seal";
import { herald } from "@warlock.js/herald";

const userSchema = v.object({
  userId: v.int(),
  email: v.string().email(),
});

const channel = herald().channel("user.created", { schema: userSchema });

await channel.publish({ userId: 1, email: "not-an-email" });
// → throws "Message validation failed: [...]"
```

The schema also runs on the **consume** side, so if some other producer pushes a bad payload into the same queue, the consumer rejects it without your handler ever running. See [the messaging model](../essentials/01-the-messaging-model.md#schema-validated-channels).

## Publish options

```ts
await channel.publish(payload, {
  priority: 5,              // 0-9, higher = served first (queue must support priority)
  expiration: 60_000,       // ms — message expires if not consumed in time
  delay: 5_000,             // ms — delayed delivery (requires rabbitmq-delayed-message-exchange plugin)
  persistent: true,         // survive broker restart (default true)
  correlationId: "req-123", // tag for tracing across services
  headers: {
    tenantId: "42",
    source: "billing-service",
  },
});
```

All `PublishOptions` fields:

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `priority` | `number` | unset | Priority hint (0–9). Higher served first. The queue must be declared with `x-max-priority` for it to matter — out of scope of `ChannelOptions` today; assert manually via the raw channel if needed. |
| `ttl` | `number` | unset | Per-message TTL in ms. (Not yet wired through to amqplib in the current driver — use `expiration` instead.) |
| `expiration` | `number` | unset | Message expires after this many ms if not consumed. Mapped to AMQP `expiration`. |
| `delay` | `number` | unset | Sets `x-delay` header for the [delayed-message exchange plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange). No-op without the plugin. |
| `persistent` | `boolean` | `true` | Marks the message persistent. Survives broker restart paired with a durable queue. |
| `correlationId` | `string` | unset | Free-form ID — used by request-and-respond, also useful for cross-service tracing. |
| `headers` | `Record<string, string>` | unset | Free-form headers. Consumer reads via `message.metadata.headers`. |

Headers are the right place for routing or filtering info — `tenantId`, `source`, feature flags. Just don't put secrets in them; they travel in plaintext (encrypted only by TLS in transit, not at rest in the broker).

## Batch publishing

`publishBatch` accepts an array and applies the same options to every entry:

```ts
await channel.publishBatch(
  [
    { userId: 1, email: "a@example.com" },
    { userId: 2, email: "b@example.com" },
    { userId: 3, email: "c@example.com" },
  ],
  {
    persistent: true,
  },
);
```

Under the hood it iterates and calls `publish` per message — there's no AMQP-level batching today. The shape exists so you have a clean API for "publish these N items"; treat it as ergonomic, not a throughput optimization.

## Don't publish inside a database transaction

This is the easiest footgun to hit:

```ts
// ❌ Bad — publish before commit, transaction rolls back, event leaked
await db.transaction(async () => {
  await Order.create(orderData);
  await herald().channel("order.created").publish({ orderId: order.id });
});
```

If the transaction rolls back, you've emitted an event for a state that never persisted. Use the **outbox pattern** instead — write the event to a database table inside the transaction, then a separate worker drains the table:

```ts
await db.transaction(async () => {
  const order = await Order.create(orderData);
  await Outbox.create({
    channel: "order.created",
    payload: { orderId: order.id },
    status: "pending",
  });
});

// Drain worker (runs continuously, separate process):
const pending = await Outbox.where("status", "pending").get();

for (const row of pending) {
  await herald().channel(row.get("channel")).publish(row.get("payload"));
  await row.merge({ status: "sent" }).save();
}
```

The transaction guarantees that the order and the outbox row commit together. The worker guarantees the publish happens at least once. The consumer side just needs to handle duplicates (idempotent handlers — store `messageId` in a processed-messages table, skip on hit).

## Producer-side gotchas

- **JSON-serializable payloads only.** Functions, `BigInt`, class instances with non-serializable methods → silent data loss or thrown errors. Stick to plain data.
- **`persistent: true` matters with a durable queue.** Persistent message + non-durable queue → still loses on restart. Both must be set.
- **`expiration: 0` means "expire immediately".** Probably not what you want — omit the field if you don't need TTL.
- **Don't publish from inside a consumer's handler without an ack first.** Otherwise an unprocessed message holds prefetch slots open. Ack, then publish, then return.

## Next

- [Consume messages](./consume-message.md) — the receiving side.
- [Request and respond](./request-and-respond.md) — when you need a reply over the bus.
- [Handle errors and retries](./handle-errors-and-retries.md) — what happens when things go sideways.
