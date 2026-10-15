---
title: "Introduction"
description: What @warlock.js/herald is, when to reach for it, and how it compares to raw amqplib, HTTP, and in-process events.
sidebar:
  order: 1
  label: "Introduction"
---

Herald is a typed message-bus library for Node. You connect to a broker — RabbitMQ today, more drivers coming — and pass payloads around your services through named channels: one side calls `publish`, the other side `subscribe`s. That's it. No queue topology to memorize, no callbacks to chain, no per-driver SDK to learn.

> **Standalone** — usable in any Node project. No `@warlock.js/core` required, no framework to opt into. Drop the `connectToBroker` call into your bootstrap and you're done.

## The whole thing in 15 lines

Connect, subscribe, publish — one message from producer to consumer:

```ts
import { connectToBroker, herald } from "@warlock.js/herald";

await connectToBroker({ driver: "rabbitmq", host: "localhost" });

const channel = herald().channel<{ userId: number }>("user.created");

await channel.subscribe(async (message, ctx) => {
  console.log("New user:", message.payload.userId); // → New user: 1
  await ctx.ack(); // done — remove it from the queue
});

await channel.publish({ userId: 1 });
```

That's the entire surface for fire-and-forget messaging. Everything below is depth: options, retries, dead-letter, request/respond. The full walkthrough — including splitting producer and consumer into separate processes — is in [your first message](./03-your-first-message.md).

## What you get

- **A unified pub/sub API across drivers.** Today that's RabbitMQ (AMQP). Tomorrow Kafka. You write `channel.publish(payload)` and `channel.subscribe(handler)`; switching brokers is a config change, not a rewrite.
- **Type-safe channels.** `herald().channel<UserPayload>("user.created")` gives you full TypeScript inference on both ends. Publishers can't send the wrong shape, consumers can't read fields that don't exist.
- **Optional schema validation.** Plug a `@warlock.js/seal` schema into a channel and herald validates payloads on the way out (producer) and on the way in (consumer) — invalid messages never escape the producer, and a corrupted one in flight gets rejected before your handler runs.
- **Multi-broker out of the box.** Run a `notifications` broker on one box and an `analytics` broker on another. `herald("analytics")` reaches the second; bare `herald()` keeps reaching the first.
- **Sensible ack semantics.** Default is **manual ack** — a crashed consumer never loses a message. The broker redelivers and a sibling worker picks it up.
- **Reconnects without ceremony.** The RabbitMQ driver reconnects after broker restarts. You don't write the loop.

## When to reach for it

| Use herald | Use something else |
| --- | --- |
| Decoupling services — service A emits, service B reacts, neither imports the other | A single process — use a plain `EventEmitter` or a function call |
| Backpressure matters — a slow consumer shouldn't crash the producer | Fire-and-forget logging — append to a log file or stdout |
| Work must survive a crash — orders, payments, emails | Optional cache writes — they can be lost without consequence |
| Fan-out work to N workers — N consumers in the same `group` split the load | One-shot scripts — just do the work inline |
| Cross-language messaging — Python writes, Node reads, both speak AMQP | Two TypeScript modules in the same repo — import directly |

## Herald vs raw amqplib

`amqplib` is the AMQP client herald sits on top of. The raw client is fine — until you've written the third "assert queue, parse Buffer, manage acks, handle reconnect" boilerplate. Herald collapses all of that:

```ts
// Raw amqplib — every queue, every consumer
const conn = await amqp.connect("amqp://localhost");
const ch = await conn.createChannel();
await ch.assertQueue("user.created", { durable: true });
ch.consume("user.created", (msg) => {
  if (!msg) return;
  const payload = JSON.parse(msg.content.toString());
  // ...handle...
  ch.ack(msg);
});
```

```ts
// Herald — same job, one stanza
await connectToBroker({ driver: "rabbitmq", host: "localhost" });

herald()
  .channel<UserPayload>("user.created")
  .subscribe(async (message, ctx) => {
    // ...handle message.payload...
    await ctx.ack();
  });
```

You still get the raw AMQP channel if you need it (`driver.getRawChannel()`), so escape hatches exist when herald's defaults don't fit.

## Herald vs HTTP

HTTP is synchronous, point-to-point, and fast for sub-100ms ops. Herald is asynchronous, decoupled, and shines when the work has variable duration or needs a queue's backpressure. Most apps use both — HTTP at the edge, herald between services.

For the rare case where you _need_ a reply over the bus, herald has [request-and-respond](../guides/request-and-respond.md) — RPC over queues with a typed promise.

## Herald vs in-process events

If everything lives in one process, a plain `EventEmitter` or `@mongez/events` is simpler, faster, and has zero infrastructure. Reach for herald when the producer and consumer are in different processes — or when you need persistence, backpressure, or replay.

## Next

- [Installation](./02-installation.mdx) — get herald + the AMQP client in.
- [Your first message](./03-your-first-message.md) — publish, consume, see it land.
