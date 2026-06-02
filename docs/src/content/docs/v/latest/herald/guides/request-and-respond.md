---
title: "Request and respond"
description: RPC over the message bus — channel.request waits for a reply, channel.respond registers the responder, with typed promises and timeouts.
sidebar:
  order: 3
  label: "Request and respond"
---

Most messaging is fire-and-forget. When you need a reply — "compute this tax, give me the number" — herald has a request/respond pair. Under the hood it's a temporary reply queue plus correlation-ID matching; on the surface, it's a typed promise.

## The shape

```ts
import { herald } from "@warlock.js/herald";

type TaxRequest = { amount: number; country: string };
type TaxReply = { tax: number; currency: string };

// Caller
const reply = await herald()
  .channel<TaxRequest>("compute.tax")
  .request<TaxReply>(
    { amount: 1000, country: "US" },
    { timeout: 30_000 },
  );

console.log(reply.tax, reply.currency);

// Responder
herald()
  .channel<TaxRequest>("compute.tax")
  .respond<TaxReply>(async (message) => {
    const tax = await computeTax(message.payload);
    return { tax, currency: "USD" };
  });
```

The responder's return value becomes the reply. You can also reply explicitly via `ctx.reply(payload)` — useful when the reply happens partway through the handler.

## What happens under the hood

1. `request` creates an **exclusive auto-delete reply queue** with a random name.
2. It generates a `correlationId` for this call.
3. It publishes your payload to the channel with `replyTo: <reply-queue>` and the correlation ID.
4. It starts consuming the reply queue and waits.
5. The responder receives the message, runs your handler, and calls `ctx.reply` (or your handler returns and `respond` calls it for you).
6. The reply is sent to `msg.properties.replyTo` with the same correlation ID.
7. The caller's promise resolves with `content.payload`.
8. The reply queue auto-deletes when the caller disconnects.

You don't manage any of this. The correlation ID is generated and matched for you; the reply queue is created and torn down for you.

## Timeout

```ts
await channel.request(payload, { timeout: 30_000 });
```

The default is **30 seconds**. The promise rejects with `Error: Request timeout after Nms` if no reply arrives in time. The AMQP message itself also gets an `expiration` set to the same value — so a request sitting in the queue too long won't be picked up by a responder that just came back online and then have to be discarded.

Pick a sane number:

- **Too short** — you'll reject mid-work for slow ops.
- **Too long** — a hung responder blocks the caller for ages, then you've got connection / memory pressure.
- **`Infinity`** — don't. A stuck request becomes a leaked promise and a leaked reply queue.

## When to use it vs HTTP

| Use HTTP | Use request/respond |
| --- | --- |
| Stateless, fast, idempotent ops | Slow / queued ops where the caller can wait |
| Public API surface — frontend or third-party calls | Internal service-to-service backend orchestration |
| Sub-100ms latency budget | Variable duration, queueing helps |
| You want a load balancer's request routing | You want a queue's backpressure |

The bus adds at least one broker hop in each direction (round-trip), so it's almost never faster than HTTP for a single request. The wins are: persistent retries, backpressure across the worker pool, the same connection moves async events and sync requests, no separate HTTP load balancer / proxy / cert story.

## When NOT to use it

- **"I need a result in under 50ms."** Bus round-trip costs alone are probably more than your budget.
- **"The responder might be down for hours."** Every request times out; nothing useful happens. Use `publish` and have the caller poll for a result somewhere instead.
- **"Many callers want the same answer."** Compute once, cache the result, use `publish` for invalidation.
- **"I want multiple replies."** `request` resolves on the first reply. For broadcast-then-collect, use `publish` + a result channel and have each responder write back independently.

## Multiple responders

If multiple consumers `respond()` to the same channel:

- They're all on the same queue, so RabbitMQ round-robins between them — **one responder takes each request, the caller gets exactly one reply.**

That's the "share work across responders" pattern — exactly like a worker pool, but synchronous. Each responder needs to be functionally identical because the caller has no control over which one handled the request.

## Correlation in your own logs

Herald generates and matches correlation IDs for `request` automatically — you don't see them. If you want to thread your own tracing ID through, pass it as a header:

```ts
await channel.request(payload, {
  timeout: 30_000,
  headers: { traceId: span.spanContext().traceId },
});
```

The responder reads it from `message.metadata.headers.traceId` and includes it in its own log lines. (The bus correlation ID is for matching request to reply; your trace ID is for connecting log lines.)

## Don't return huge payloads from `respond`

Reply messages travel through the broker. A multi-MB reply hits broker memory + caller memory and slows everything in the queue:

```ts
// ❌ 50MB JSON over the bus
channel.respond(async (message) => {
  return { records: await db.allRecords() };
});

// ✅ Write big results to S3, reply with a reference
channel.respond(async (message) => {
  const url = await s3.upload(await db.allRecords());
  return { resultsUrl: url };
});
```

The caller fetches from S3 directly. The bus stays fast.

## Don't set timeout to `Infinity`

A stuck request without a timeout leaks:

- The caller's promise never resolves.
- The reply queue stays open until the caller disconnects.
- If the caller is long-lived, the queue accumulates.

Always set a real timeout, even if it's 10 minutes. Catch the rejection and decide whether to retry, fail the operation, or alert.

## Things NOT to do

- **`channel.respond` from inside another consumer's handler** — you'll create circular delivery. Set up your responders at boot, not on demand.
- **Long-lived `respond` registered then forgotten** — if the responder process crashes, every caller's request times out and they don't know why. Add a process monitor / health check.
- **Mixing `subscribe` and `respond` on the same channel** — both register consumers on the same queue. Pick one shape per channel.

## Next

- [Publish messages](./publish-message.md) — fire-and-forget.
- [Consume messages](./consume-message.md) — `subscribe` + `ctx`.
- [Handle errors and retries](./handle-errors-and-retries.md) — what to do when the responder is down.
