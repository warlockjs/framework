---
name: request-and-respond
description: "Request-response over the bus in @warlock.js/herald; use when you need to request and respond."
---

# Request-response over the bus

Most messaging is fire-and-forget. When you need a reply, use the request/respond pair — a reply-queue + correlation-id pattern under the hood, surfaced as a typed promise.

## Shape

```ts
// Caller (client)
const response = await herald()
  .channel<RequestPayload>("compute.tax")
  .request<TaxResponse>({ amount: 1000, country: "US" }, { timeout: 30_000 });

// Responder (server)
herald()
  .channel<RequestPayload>("compute.tax")
  .respond(async (message, ctx) => {
    const tax = await computeTax(message.payload);
    return { tax, currency: "USD" }; // ← the return value IS the reply
  });
```

`request` returns a promise that resolves with the responder's return value. `respond` registers a handler and **automatically replies with whatever the handler returns** (then acks) — so just `return` the response; you don't call `ctx.reply()` yourself inside a `respond` handler. (`ctx.reply` is the lower-level primitive used when you wire a plain `.subscribe()` as a responder by hand.)

## Timeout

```ts
await channel.request(payload, { timeout: 30_000 });
```

The promise rejects if no reply arrives within `timeout` ms. Pick a sane number — too short rejects mid-work; too long lets a hung responder block the caller.

## When to use it vs HTTP

| Use HTTP | Use request/respond |
| --- | --- |
| Stateless, fast, idempotent ops | Slow / queued ops where the caller can wait |
| Public API surface | Internal service-to-service |
| Frontend consumption | Backend orchestration |
| Synchronous user-facing flow | Async-but-needs-result patterns |

The bus adds queue persistence and retry. HTTP is faster for sub-100ms ops; the bus shines when the operation has variable duration or needs a queue's backpressure.

## When NOT to use it

- "I need a result in under 50ms" — too much overhead on the bus.
- "The responder might be down for hours" — request will time out repeatedly; consider `publish` + write the result somewhere the caller polls.
- "Many callers, the response is the same for all" — cache the result and use `publish` for invalidation.

## Multiple responders

`respond(handler)` takes no options — there's no `group` knob here. If multiple consumers `respond()` to the same channel, they all sit on the same queue, so RabbitMQ round-robins between them: **one responder handles each request, and the caller gets exactly one reply.** That's the "share work across responders" pattern — a synchronous worker pool. Make every responder functionally identical, since the caller has no say in which one answers.

For "multiple replies expected" patterns, use a regular `subscribe` + a request id, then the caller listens on a result channel.

## Correlation across replies

Each `request()` generates its own correlation ID and an exclusive reply queue under the hood. The reply carries the same ID; the client matches it to the awaiting promise and resolves. You don't manage correlation IDs manually — and you shouldn't pass your own `correlationId` on a `request()`, since herald overwrites it with the one it uses to match the reply. To thread your own trace id (e.g. a transaction id for logs) through to the responder, put it in `headers` instead — the responder reads it from `message.metadata.headers`.

## Things NOT to do

- Don't use request/respond for high-throughput, low-latency ops. The reply-queue round-trip adds at least one broker hop. HTTP is the right tool.
- Don't return huge payloads from `respond`. Reply messages travel through the broker; a multi-MB response is a load on the bus and on memory. For big results, write to S3 / cache and reply with a reference.
- Don't forget to `respond` in long-lived consumers. If the responder crashes, every caller's request will time out — they don't know why.
- Don't set timeout to `Infinity`. A stuck request becomes a leaked promise — set a real timeout and handle the rejection.

## See also

- [`@warlock.js/herald/publish-message/SKILL.md`](@warlock.js/herald/publish-message/SKILL.md) — fire-and-forget pattern
- [`@warlock.js/herald/consume-message/SKILL.md`](@warlock.js/herald/consume-message/SKILL.md) — subscribe + ctx flow control (including `ctx.reply`)
