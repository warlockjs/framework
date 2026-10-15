---
title: "The messaging model"
description: How herald maps onto RabbitMQ — channels, queues, ack semantics, and what the metadata envelope looks like on the wire.
sidebar:
  order: 1
  label: "The messaging model"
---

Herald's API has three nouns: **broker**, **channel**, **message**. Two verbs: **publish** and **subscribe**. Everything else is options. Before you write production code, it pays to know what those nouns map to inside RabbitMQ, because that's where the durability and delivery guarantees actually live.

## Broker

A **broker** is a connection to one RabbitMQ server (or cluster). You register brokers by calling `connectToBroker`; the first one becomes the default. `herald()` returns the default; `herald("analytics")` returns a named one.

Under the hood every broker holds:

- An AMQP **connection** (one TCP socket, with a heartbeat).
- An AMQP **channel** (a logical pipe inside the connection — herald uses one per broker).
- A **channels map** — herald-level channel objects keyed by channel name.

The herald-level "channel" is **not** the same thing as an AMQP channel. The naming overlap is unfortunate but consistent with how higher-level libraries describe pub/sub topics. Whenever this doc says "channel" without qualifying, it means the herald one.

## Channel

A herald channel is a **named pub/sub endpoint**. Today the RabbitMQ driver maps every channel one-to-one onto a **durable queue** with the same name. That has two consequences worth knowing:

1. **Producers and consumers reach the same queue if they use the same channel name.** No exchanges, no routing keys, no bindings — herald uses the default exchange and routes by queue name.
2. **Multiple consumers on the same channel split work** — RabbitMQ round-robins messages across consumers on a queue. If you want N workers to share load, point them all at the same channel name. (If you want every consumer to receive every message, you need a different routing model — not in scope today.)

The first time you call `channel.publish` or `channel.subscribe`, herald lazily asserts the queue with these defaults:

| Option | Default | Why |
| --- | --- | --- |
| `durable` | `true` | Queue survives broker restart. |
| `autoDelete` | `false` | Queue sticks around when last consumer disconnects. |
| `exclusive` | `false` | Multiple connections can subscribe. |
| `messageTtl` | unset | Messages never expire by queue policy. |
| `maxLength` | unset | Queue can grow unbounded — you set policy if needed. |

Override any of these by passing options on the first access:

```ts
const channel = herald().channel<OrderPayload>("orders", {
  durable: true,
  messageTtl: 60_000,        // messages expire after 1 minute in queue
  maxLength: 10_000,         // oldest evicted after 10k
  deadLetter: {
    channel: "orders.failed",
  },
});
```

The first call to `.publish` / `.subscribe` triggers the assert. After that, herald caches the channel object — subsequent `herald().channel("orders")` calls return the same instance and skip the assert.

## Message

A **message** is a typed envelope. Herald wraps your payload with metadata before handing it to RabbitMQ:

```ts
// Wire format (JSON in the AMQP message body)
{
  "payload": { "userId": 1, "email": "ada@example.com" },
  "metadata": {
    "messageId": "uuid-v4",
    "timestamp": "2026-05-27T10:00:00.000Z",
    "correlationId": "request-123",
    "headers": { "tenantId": "42" }
  }
}
```

On the receive side, the handler gets a `Message<TPayload>` with this shape:

```ts
type Message<TPayload> = {
  readonly metadata: MessageMetadata;
  readonly payload: TPayload;
  readonly raw?: unknown;          // raw AMQP message, escape hatch
};

type MessageMetadata = {
  messageId: string;
  correlationId?: string;
  replyTo?: string;
  priority?: number;
  timestamp: Date;
  headers?: Record<string, string>;
  retryCount?: number;
  originalChannel?: string;
};
```

`raw` is the underlying AMQP message — useful when you need an option herald doesn't surface. `originalChannel` is set to the channel the message was first published to; if the message landed in a dead-letter queue, this lets you recover where it came from.

## Ack semantics

This is the bit that bites people. Herald's default is **manual ack** — the consumer must call `ctx.ack()` (or `ctx.nack()`, or `ctx.reject()`) for every message. Until then, the broker considers the message **in flight**.

The RabbitMQ driver layers a **smart auto-behavior** on top:

- Handler returns normally without calling ack → herald **auto-acks**.
- Handler throws → herald **auto-nacks** (requeue or DLQ depending on `retry` + `deadLetter` config).
- Handler explicitly calls ack / nack / reject / retry → herald respects that call.

In other words, you can write a handler that never touches `ctx` and it still works correctly. But the explicit calls give you control over **what kind of failure** this is (transient → requeue, permanent → reject), and they make the code easier to read.

```ts
await channel.subscribe(async (message, ctx) => {
  try {
    await sendEmail(message.payload);
    await ctx.ack();          // success
  } catch (error) {
    if (isTransient(error)) {
      await ctx.nack(true);   // requeue
    } else {
      await ctx.reject();     // permanent failure → DLQ if configured
    }
  }
});
```

| `ctx` call | Effect |
| --- | --- |
| `ctx.ack()` | Message removed from queue. |
| `ctx.nack(true)` | Message requeued — broker redelivers. |
| `ctx.nack(false)` / `ctx.reject()` | Message dropped (or sent to DLQ if configured). |
| `ctx.retry(delayMs)` | Message republished with a retry counter; goes to DLQ when `maxRetries` exceeded. |
| `ctx.reply(payload)` | Sends `payload` to the original requester (only for [request-and-respond](../guides/request-and-respond.md)). |

`autoAck: true` in `SubscribeOptions` switches to AMQP's native `noAck: true` — the broker considers every delivered message acked the moment it leaves the queue. **Don't use this for messages that matter** — a crash mid-handling loses the message.

## Schema-validated channels

Pass a `@warlock.js/seal` schema in `ChannelOptions.schema` and herald runs `v.validate(schema, payload)`:

- **On publish**, before the message hits the broker. Invalid payloads throw at the producer.
- **On consume**, before the handler runs. Invalid payloads get nacked (not requeued) — they'd loop forever otherwise.

```ts
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  userId: v.int(),
  email: v.string().email(),
});

const channel = herald().channel("user.created", { schema: userSchema });

await channel.publish({ userId: 1, email: "not-an-email" });
// → throws "Message validation failed: [...]"
```

Use it when payload shape is a contract you want enforced at the boundary — most domain events.

## Next

- **Connection + config** — production setup, multi-broker, reconnects: [connection-and-config](./02-connection-and-config.md).
- **Publishing in depth** — [guides/publish-message](../guides/publish-message.md).
- **Consuming in depth** — [guides/consume-message](../guides/consume-message.md).
