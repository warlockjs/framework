---
name: publish-message
description: 'Publish messages to a channel — .publish(payload, options?) for single, .publishBatch([...], options?) for batch, with priority / ttl / delay / persistent / correlationId / headers options. Optional schema validation via .channel(name, {schema}). Triggers: `publish`, `publishBatch`, `channel`, `priority`, `ttl`, `delay`, `persistent`, `correlationId`, `headers`, `schema`; "publish a message", "emit an event after a domain change", "fan out a notification", "schedule delayed work", "batch publish"; typical import `import { herald } from "@warlock.js/herald"`. Skip: setup — the `herald-basics` topic; consuming — the `consume-message` topic; RPC — the `request-and-respond` topic; competing libs `amqplib`, `kafkajs`, `bullmq`; NestJS `ClientProxy.emit`.'
---

# Publish messages

Push messages into a channel. The consumer side picks them up via the `consume-message` topic.

## Single publish

```ts
import { herald } from "@warlock.js/herald";

await herald().channel("user.created").publish({
  userId: 1,
  email: "ada@example.com",
});
```

Returns when the broker has accepted the message (not when a consumer has handled it — that's `.request()` territory).

## Typed channels

```ts
type UserPayload = { userId: number; email: string };

const channel = herald().channel<UserPayload>("user.created");

await channel.publish({ userId: 1, email: "test@example.com" }); // ✅ typed
await channel.publish({ userId: "1" } as never); // ❌ compile error
```

Share the payload type between producer and consumer via a common `types/` file.

## Schema-validated publish

```ts
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  userId: v.int(),
  email: v.string().email(),
});

const channel = herald().channel("user.created", { schema: userSchema });

await channel.publish({ userId: 1, email: "invalid" }); // Throws — fails .email()
```

The schema runs `validate()` before the message hits the broker. Invalid payloads never leave the producer. See the `seal-basics` topic of the `warlock-js-seal` skill.

## Publish options

```ts
await channel.publish(payload, {
  priority: 5, // 0-9, higher = served first
  expiration: 60_000, // ms — message expires if not consumed (RabbitMQ uses `expiration`, not `ttl`)
  delay: 5_000, // ms — delayed delivery (requires RabbitMQ delay plugin)
  persistent: true, // survive broker restart (default true)
  correlationId: "uuid", // for tracking across services
  headers: {
    tenantId: "42",
    source: "billing-service",
  },
});
```

The headers field is free-form — consumers read `message.metadata.headers?.tenantId` to route or filter (headers live under `message.metadata`, alongside `messageId`, `correlationId`, `timestamp`, and `retryCount`).

## Batch publishing

```ts
await channel.publishBatch(
  [
    { userId: 1, email: "a@example.com" },
    { userId: 2, email: "b@example.com" },
    { userId: 3, email: "c@example.com" },
  ],
  {
    // Options apply to every message in the batch
    persistent: true,
  },
);
```

Under the hood `publishBatch` iterates and calls `.publish()` per message — there's no AMQP-level batching today. It's an ergonomic shape for "emit these N items" (bulk import, fanout to many recipients), not a throughput optimization. The same `options` apply to every message.

## Publish + transaction (outbox pattern)

Don't publish inside a database transaction — if the transaction rolls back but the publish already happened, you've emitted an event for a state that never persisted.

The outbox pattern: write to an `outbox` table inside the transaction, dispatch from the outbox via a worker after commit:

```ts
await transaction(async () => {
  await Order.create(orderData);
  await Outbox.create({
    channel: "order.created",
    payload: { orderId: order.id, ... },
    status: "pending",
  });
});

// In a separate worker:
const pending = await Outbox.where("status", "pending").get();
for (const row of pending) {
  await herald().channel(row.get("channel")).publish(row.get("payload"));
  await row.merge({ status: "sent", sent_at: new Date() }).save();
}
```

Full recipe at `domains/cascade/docs/recipes/outbox-pattern.md`.

## Broadcasting use-case results

`@warlock.js/herald` ships `heraldBroadcast()` — a channel adapter that lets a `@warlock.js/core` `useCase()` publish its result to the bus automatically on success. Register it once in the use-cases config; each use case opts in with `broadcast: true`.

```ts title="src/config/use-cases.ts"
import { type UseCaseConfigurations } from "@warlock.js/core";
import { heraldBroadcast } from "@warlock.js/herald";

export default {
  broadcast: {
    enabled: true,
    channels: [heraldBroadcast({ broker: "default" })], // omit broker for the default
  },
} satisfies UseCaseConfigurations;
```

```ts
// The use case opts in — channel name defaults to the use case name.
export const createUserUseCase = useCase({
  name: "users.create", // → publishes to channel "users.create"
  schema: createUserSchema,
  handler: async (data) => User.create(data),
  broadcast: true,
});
```

The adapter publishes the broadcast envelope's `payload` to `channel(event.event)`. It's structurally typed, so herald keeps no dependency on core. See the `write-use-case` topic of the `warlock-js-core` skill for the `broadcast` option (payload projection, custom event name, payload-safety rules).

## Event classes (`EventMessage`) — the typed event layer

Raw `channel(name).publish(payload)` is the low-level path. For domain events that travel between modules, herald ships a higher-level pair: define the event once as a class, publish instances of it, and consume them with an `EventConsumer` (the `consume-message` topic). The channel name comes from the event's `eventName` — no string to keep in sync across producer and consumer.

```ts
import { defineEvent, publishEvent } from "@warlock.js/herald";

// `defineEvent<IncomingData, OutgoingData>` — `toJSON` projects the wire payload.
const UserCreatedEvent = defineEvent<User, { id: number; email: string }>("user.created", {
  toJSON: (user) => ({ id: user.id, email: user.email }),
  // schema?: an @warlock.js/seal ObjectValidator (held on the instance; the consumer side validates)
});

// `publishEvent` serializes the instance and publishes to channel "user.created" on the default broker.
await publishEvent(new UserCreatedEvent(user));
```

`publishEvent(event)` is shorthand for `herald().publish(event)` — it calls `event.serialize()` and sends an **envelope**: `{ payload, metadata, messageId, eventName, version, occurredAt }`. That nesting is why an `EventConsumer` reads `envelope.payload`, not the raw body — pair this only with the consumer side, not a bare `.subscribe()`.

Set an optional `version` on the event (instance field) to drive the consumer's `minVersion` / `maxVersion` acceptance gate. The class form (`class X extends EventMessage`) is equivalent — override `toJSON()` and set `eventName`, `version`, `schema` as fields.

## Things NOT to do

- Don't publish inside a transaction. Use the outbox pattern.
- Don't pass non-JSON-serializable values (functions, `BigInt`, class instances with methods). Serialization happens at the broker boundary; functions go silent, BigInt throws.
- Don't `expiration: 0` — set a real expiry or omit. `0` means "expire immediately."
- Don't omit `persistent: true` for messages where loss matters. Default is `true` in this lib, but worth being explicit when the message represents money / customer state.
- Don't put secrets in headers. Headers travel in plaintext (encrypted only by TLS in transit, not at rest in the broker).

## See also

- The `consume-message` topic — the receiving side
- The `request-and-respond` topic — when you need a reply
