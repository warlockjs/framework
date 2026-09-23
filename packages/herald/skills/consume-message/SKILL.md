---
name: consume-message
description: "Consume messages in @warlock.js/herald; use when you need to consume message."
---

# Consume messages

Subscribe to a channel; receive each message with a flow-control `ctx`.

## Minimal subscribe

```ts
import { herald } from "@warlock.js/herald";

herald()
  .channel<{ userId: number; email: string }>("user.created")
  .subscribe(async (message, ctx) => {
    try {
      await sendWelcomeEmail(message.payload.email);
      await ctx.ack();          // success — message removed from queue
    } catch (error) {
      await ctx.nack(true);     // failure — requeue for redelivery
    }
  });
```

**Smart auto-ack is on by default** (when `autoAck` is unset or `false`). The consumer runs with manual-ack enabled, and herald acks/nacks based on how your handler ends:

- Handler returns without calling any `ctx` method → herald **auto-acks**.
- Handler **throws** → herald **auto-nacks** (requeue, or DLQ/reject once retries are exhausted — see below).
- Handler calls `ctx.ack()` / `ctx.nack()` / `ctx.reject()` / `ctx.retry()` → herald respects that and does nothing further.

So the `try/catch` above is optional — letting the error throw produces the same auto-nack. Call `ctx` methods explicitly only when you want a *non-default* outcome (reject without requeue, route to DLQ, delayed retry). The one mode that loses messages is `autoAck: true`, where the broker acks on delivery before your handler runs.

## Message context — flow control

```ts
ctx.ack();              // acknowledge — message removed from the queue
ctx.nack(requeue?);     // negative ack — requeue (true) or send to DLQ (false)
ctx.reject();           // shorthand for nack(false)
ctx.retry(delayMs);     // delayed retry — requeue after delay
ctx.reply(payload);     // for request-response pattern (see request-and-respond skill)
```

Pick by intent:

| Intent | Use |
| --- | --- |
| Processed cleanly | `ctx.ack()` |
| Transient failure, try again | `ctx.nack(true)` or `ctx.retry(5000)` |
| Permanent failure, send to DLQ | `ctx.nack(false)` or `ctx.reject()` |
| Validation failure (bad message) | `ctx.reject()` — don't requeue |

## Subscribe options

```ts
await channel.subscribe(handler, {
  group: "email-workers",      // consumer group / tag — multiple consumers share work
  prefetch: 10,                 // concurrency — how many in-flight messages this consumer holds
  autoAck: false,               // default; keep it false in production
  exclusive: false,             // single consumer only on this channel?
  retry: {
    maxRetries: 3,              // redelivery ceiling on handler throw (delay not auto-applied — see below)
    delay: 1000,
  },
  deadLetter: {
    channel: "user.created.failed",
    preserveOriginal: true,
  },
});
```

`group` is the unit of "share work" — N consumers in the same group split messages across them. Different groups each receive every message (fanout).

`prefetch` is the per-consumer concurrency cap. Higher = throughput; lower = even spread. For CPU-bound handlers, set ~= CPU cores. For IO-bound, can go higher (50+).

## Retry policy

```ts
retry: {
  maxRetries: 3,
  delay: 1000,                  // see the caveat below — delay is not auto-applied
}
```

`maxRetries` is the part that does the work: when a handler **throws**, herald reads the message's `x-retry-count` header and, while it's under `maxRetries`, republishes with the header incremented so the count actually advances (a plain requeue never advances it — the broker doesn't add that header). Once `x-retry-count` reaches `maxRetries`, it dead-letters (if `deadLetter` is configured) or drops the message with a loud `log.error` — a poison message can no longer ping-pong forever. This is shared by the automatic throw path and the explicit `ctx.retry()` call, so both honor the same cap.

**Caveat on `delay`.** `RetryOptions.delay` (number or `(attempt) => number`) is **not applied on the automatic throw path** — a thrown handler requeues immediately, with no wait. The only place a delay takes effect is the explicit `ctx.retry(delayMs)` call, which republishes the message with an `x-delay` header — and even that needs the RabbitMQ delayed-message-exchange plugin installed, or the delay is ignored. So if you need real backoff, call `ctx.retry(ms)` from inside the handler and install the plugin; don't rely on the channel-level `retry.delay` for timing.

## Dead-letter queue

```ts
deadLetter: {
  channel: "user.created.failed",
  preserveOriginal: true,        // accepted, but currently a no-op (see note)
}
```

The DLQ always forwards the full original payload plus the message metadata, so `preserveOriginal` makes no observable difference today — the field is part of the type but the RabbitMQ driver doesn't branch on it yet. Set it or omit it; behaviour is the same.

Messages that exhausted retries land in `user.created.failed`. Subscribe to it separately for alerting / manual inspection:

```ts
herald().channel("user.created.failed").subscribe(async (message, ctx) => {
  await alerts.notify(`Failed: ${JSON.stringify(message.payload)}`);
  await ctx.ack();
});
```

## Decorator-style consumers — `@Consumable` + `EventConsumer`

For class-based consumers that pair with the [`EventMessage`](@warlock.js/herald/publish-message/SKILL.md) producer layer. This is a **different handler shape** from the raw `.subscribe()` above — ack/nack is automatic, and you get the unwrapped payload plus an event-metadata object (no `ctx`):

```ts
import { Consumable, EventConsumer } from "@warlock.js/herald";
import type { ConsumedEventMessage } from "@warlock.js/herald";

@Consumable()  // or @Consumable({ broker: "analytics" }) to target a non-default broker
export class UserCreatedConsumer extends EventConsumer<{ id: number; email: string }> {
  public static eventName = "user.created";

  // handle(payload, event) — NOT (message, ctx). No ctx.ack() here.
  public async handle(payload: { id: number; email: string }, event: ConsumedEventMessage) {
    await sendWelcomeEmail(payload.email);
    // return cleanly → herald acks. throw → herald retries (bounded — see below).
  }
}
```

The handler receives the **already-unwrapped payload** as the first argument and a `ConsumedEventMessage` as the second — `{ messageId, eventName, payload, version?, occurredAt?, metadata?, message }` (where `message` is the raw `Message` if you need `message.metadata.headers`). There is **no `ctx`**: the framework auto-acks when `handle` resolves, so you never call `ack`/`nack` yourself in this style.

**A throw is a bounded retry, not an infinite requeue.** `handle` throwing routes through the same bounded-retry routine the raw `.subscribe()` throw path uses (below) — republishes with an incremented `x-retry-count`, capped at `maxRetries: 3` (there's no per-consumer `retry`/`deadLetter` config yet, so the cap is always the default). Once the cap is hit, the message is dropped with a loud `log.error` — never a silent, unbounded ack/nack loop.

Wiring: the channel name comes from `static eventName`, and `@Consumable` self-registers the moment the class module is **imported** — if a broker is already connected it subscribes immediately, otherwise it buffers and subscribes once `connectToBroker` fires. So the only wiring you need is to import the consumer file on the boot path (e.g. your module's `main.ts`).

**Pair it with the producer:** an `EventConsumer` expects the envelope shape that `publishEvent(new SomeEvent(...))` emits — it reads `envelope.payload`. Don't point one at a channel fed by a bare `channel(name).publish(rawBody)`; the payload nesting won't match.

### Validation + version gating

Two optional gates run before `handle`, both driven by fields on the class:

```ts
import { Consumable, EventConsumer } from "@warlock.js/herald";
import { v } from "@warlock.js/seal";

@Consumable()
export class UserCreatedConsumer extends EventConsumer {
  public static eventName = "user.created";

  // Only accept events whose `version` falls in [minVersion, maxVersion].
  // Out-of-range events are acked and skipped (not requeued).
  public static minVersion = 2;
  public static maxVersion = 3;

  // Seal schema — invalid payloads are nacked before handle() runs.
  public schema = v.object({ id: v.int(), email: v.string().email() });

  public async handle(payload, event) {
    // payload is validated + version-accepted here
  }
}
```

### `defineConsumer` — no-class shorthand

```ts
import { defineConsumer } from "@warlock.js/herald";

export const userCreatedConsumer = defineConsumer<{ id: number; email: string }>("user.created", {
  schema: userCreatedSchema,                 // optional seal validation
  handle: async (payload, event) => {
    await sendWelcomeEmail(payload.email);
  },
});
```

`defineConsumer` self-registers via `@Consumable` internally, so importing the module is all the wiring it needs — same as the class form. (`subscribeConsumer(SomeConsumerClass)` is the imperative equivalent if you'd rather register explicitly.)

## Subscription handle

`subscribe()` resolves to a `Subscription` you can manage:

```ts
const subscription = await channel.subscribe(handler);

subscription.id;            // the consumer id (string)
subscription.isActive();    // boolean

await subscription.unsubscribe();   // cancel the consumer on the broker
await subscription.pause();          // also cancels the consumer (RabbitMQ has no native pause)
```

On the RabbitMQ driver, `pause()` and `unsubscribe()` both cancel the consumer; `resume()` is **not supported and throws** — create a fresh subscription to start consuming again. You can also cancel by id from the channel: `await channel.unsubscribeById(consumerId)`, or drop every consumer on the channel with `await channel.stopConsuming()`.

## Channel admin

The channel exposes queue-management helpers beyond pub/sub:

```ts
const { messageCount, consumerCount } = await channel.stats(); // queue depth + live consumers
const purged = await channel.purge();    // drop all pending messages, returns the count
const ok = await channel.exists();        // does the queue exist on the broker?
await channel.assert();                   // create the queue with its options (idempotent)
await channel.delete();                   // remove the queue entirely
```

`assert()` runs lazily on the first `publish` / `subscribe`, so you rarely call it directly — reach for it only to pre-create a queue before any traffic.

## Things NOT to do

- Don't catch the handler's error and return normally. Smart auto-ack reads a clean return as success and **acks** — silently dropping the work. Let it throw (auto-nack) or call `ctx.reject()` / `ctx.nack(false)` deliberately.
- Don't `ctx.nack(true)` in an infinite loop. With no `retry` policy, a perpetually-failing message ping-pongs forever. Set `retry.maxRetries` + a `deadLetter` so failures eventually move out.
- Don't ignore the `deadLetter` channel. Subscribe to it (or at least monitor its depth) — DLQ growth means real failures piling up.
- Don't use `autoAck: true` for messages that matter. The broker acks on delivery, so a crash mid-handling loses the message.

## See also

- [`@warlock.js/herald/publish-message/SKILL.md`](@warlock.js/herald/publish-message/SKILL.md) — the producing side
- [`@warlock.js/herald/request-and-respond/SKILL.md`](@warlock.js/herald/request-and-respond/SKILL.md) — when you need to reply to a message
