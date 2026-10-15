---
title: "Your first message"
description: Five-minute walkthrough — connect to the broker, publish a typed payload, consume it on the other end, watch it land.
sidebar:
  order: 3
  label: "Your first message"
---

You've got herald and `amqplib` installed and a broker running. Time to send a real message from producer to consumer.

The shape is always the same:

1. **Connect once** at app boot via `connectToBroker`.
2. **Grab a channel** with `herald().channel(name)`.
3. **Publish** from the producer.
4. **Subscribe** from the consumer.
5. **Ack** when you're done with the message.

## A complete script

This whole thing fits in one file — handy for the first run. In a real app the producer and consumer live in different services.

```ts title="first-message.ts"
import { connectToBroker, herald } from "@warlock.js/herald";

type UserPayload = {
  userId: number;
  email: string;
};

async function main() {
  await connectToBroker({
    driver: "rabbitmq",
    host: "localhost",
    port: 5672,
  });

  const channel = herald().channel<UserPayload>("user.created");

  await channel.subscribe(async (message, ctx) => {
    console.log("Received:", message.payload);
    await ctx.ack();
  });

  await channel.publish({
    userId: 1,
    email: "ada@example.com",
  });
}

main().catch(console.error);
```

Run it:

```bash
npx tsx first-message.ts
```

You should see:

```
Received: { userId: 1, email: 'ada@example.com' }
```

Within a second of the script starting. The process stays alive because the subscribe call keeps a consumer registered — kill it with `Ctrl+C` when you're done.

## What just happened

- **`connectToBroker`** opened an AMQP connection to RabbitMQ, created a channel under the hood, and registered a `default` broker in the in-memory registry. `herald()` later resolves to that broker.
- **`herald().channel<UserPayload>("user.created")`** returned a typed channel handle. First access lazily asserts the queue (`durable: true`, no auto-delete) — you don't pre-create queues anywhere.
- **`channel.subscribe(handler)`** registered the consumer with RabbitMQ. The handler shape is `(message, ctx) => Promise<void>`. `message.payload` is your typed payload; `ctx` is the flow-control object (ack / nack / reject / retry / reply).
- **`channel.publish(payload)`** serialized the payload, wrapped it with metadata (messageId, timestamp, headers), and handed it to RabbitMQ. The promise resolves when the broker accepts the message — not when the consumer has handled it. (For "wait for a reply", see [request-and-respond](../guides/request-and-respond.md).)
- **`ctx.ack()`** told RabbitMQ "I'm done with this one, remove it from the queue." Skip the ack and the message stays in flight until your consumer hits its prefetch limit; herald's default is **manual ack** so a crash mid-handling means the broker redelivers, not loses.

## Split producer and consumer

In production the two sides live in different processes. The producer:

```ts title="producer.ts"
import { connectToBroker, herald } from "@warlock.js/herald";
import type { UserPayload } from "./types";

await connectToBroker({ driver: "rabbitmq", host: process.env.RABBITMQ_HOST });

const channel = herald().channel<UserPayload>("user.created");

await channel.publish({ userId: 1, email: "ada@example.com" });
```

The consumer:

```ts title="consumer.ts"
import { connectToBroker, herald } from "@warlock.js/herald";
import type { UserPayload } from "./types";

await connectToBroker({ driver: "rabbitmq", host: process.env.RABBITMQ_HOST });

await herald()
  .channel<UserPayload>("user.created")
  .subscribe(async (message, ctx) => {
    try {
      await sendWelcomeEmail(message.payload.email);
      await ctx.ack();
    } catch (error) {
      await ctx.nack(true); // requeue, broker redelivers
    }
  });
```

Both sides import `UserPayload` from the same `types.ts` file. That's the contract; the broker just moves bytes.

## Where to next

- **The messaging model** — what queues, channels, and routing keys actually are: [essentials/the-messaging-model](../essentials/01-the-messaging-model.md).
- **Connection + config** — env vars, multi-broker, reconnects: [essentials/connection-and-config](../essentials/02-connection-and-config.md).
- **Production-shaped publishing** — priorities, TTL, headers, batches: [guides/publish-message](../guides/publish-message.md).
- **Production-shaped consuming** — prefetch, retry, dead-letter: [guides/consume-message](../guides/consume-message.md).
