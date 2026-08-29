---
name: herald-basics
description: 'Start with @warlock.js/herald — connectToBroker config, herald() factory, channel concept, multi-broker support. Triggers: `connectToBroker`, `herald`, `channel`, `isDefault`, `autoAck`; "set up herald", "wire connectToBroker at boot", "configure multiple brokers", "notifications + analytics + events"; typical import `import { connectToBroker, herald } from "@warlock.js/herald"`. Skip: publishing — `@warlock.js/herald/publish-message/SKILL.md`; consuming — `@warlock.js/herald/consume-message/SKILL.md`; RPC — `@warlock.js/herald/request-and-respond/SKILL.md`; competing libs `amqplib`, `kafkajs`, `bullmq`, `nats`; NestJS messaging; native `EventEmitter`.'
---

# Herald basics

Message bus library — wraps RabbitMQ (Kafka WIP) behind a unified pub/sub API. `herald()` returns a broker, `.channel(name)` returns a pub/sub interface, type-safe via TypeScript generics.

> This skill is the herald **map** — read it first, then load the specific skill for the task.

## Install

```bash
yarn add @warlock.js/herald amqplib   # amqplib for RabbitMQ
```

## Server-only package

`@warlock.js/herald`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. This is build-boundary metadata read by `@warlock.js/web`'s Gate A (import resolution) and Gate C (emitted-bundle verification), not application behavior. App code that reaches the client bundle (including page and layout modules) must not value-import `@warlock.js/herald` — Gate A refuses the build. A type-only import (`import type { ... }`) is allowed. Server loaders, controllers, and modules may import it freely.

## Foundations

1. **`connectToBroker(config)` is the bootstrap.** Call once per broker at app startup, before any publish/subscribe.
2. **`herald()` returns the default broker.** `herald("name")` returns a named one. Most apps have one broker; multi-broker is for "notifications + analytics + events" scale.
3. **`.channel(name)` is the queue / topic.** Publish into it from producer, subscribe to it from consumer.
4. **Channels are typed.** `channel<UserPayload>("user.created")` gives full TS inference on publish and subscribe.
5. **`@warlock.js/seal` schemas validate on publish + receive.** Pass `{ schema }` to `.channel(name, { schema })`.
6. **Subscribers control message flow** via `ctx.ack()` / `ctx.nack()` / `ctx.reject()` / `ctx.retry(ms)`.
7. **Smart auto-ack is the default** (`autoAck` unset/`false`). The consumer runs with manual-ack enabled, but herald acks for you when the handler returns cleanly and nacks-with-requeue when it throws — so a crash mid-handling re-delivers, and a clean handler that forgot `ctx.ack()` is still acked. Call `ctx` methods explicitly only when you need a non-default outcome (reject, DLQ, delayed retry). `autoAck: true` is the dangerous mode: the broker acks on delivery, so a crash loses the message.
8. **`username`/`password` never leak into thrown or logged errors.** They're URI-encoded when building the internal `amqp://` connection URL, and any connect failure — including one built from a caller-supplied `uri` — has `user:pass@` redacted before it's re-thrown/logged. Safe to log a connection error as-is; it will never contain a plaintext broker credential.

## Minimal example

```ts
import { connectToBroker, herald } from "@warlock.js/herald";

// Boot
await connectToBroker({
  driver: "rabbitmq",
  host: "localhost",
  port: 5672,
  username: "guest",
  password: "guest",
});

// Produce
await herald().channel("user.created").publish({ userId: 1, email: "ada@example.com" });

// Consume
herald()
  .channel<{ userId: number; email: string }>("user.created")
  .subscribe(async (message, ctx) => {
    console.log("New user:", message.payload.userId);
    await ctx.ack();
  });
```

## Multi-broker

```ts
await connectToBroker({
  driver: "rabbitmq",
  name: "notifications",
  isDefault: true,
  host: process.env.NOTIFICATIONS_HOST,
});

await connectToBroker({
  driver: "rabbitmq",
  name: "analytics",
  isDefault: false, // ← required: `isDefault` defaults to true, so omitting it makes analytics the default
  host: process.env.ANALYTICS_HOST,
});

herald().channel("emails").publish({ /* ... */ });           // → notifications
herald("analytics").channel("events").publish({ /* ... */ }); // → analytics
```

`connectToBroker` defaults `isDefault` to `true`, and the registry promotes the most-recently-registered default. So when you register more than one broker, mark the secondaries `isDefault: false` — otherwise the last one wins and `herald()` returns the wrong broker.

## Pick a skill

| If the task is about… | Load |
| --- | --- |
| Publishing messages — single + batch + publish options (priority, ttl, delay, persistent, headers) | [`@warlock.js/herald/publish-message/SKILL.md`](@warlock.js/herald/publish-message/SKILL.md) |
| Subscribing to messages — handler signature, message context (ack/nack/retry), prefetch, retry policy, dead-letter | [`@warlock.js/herald/consume-message/SKILL.md`](@warlock.js/herald/consume-message/SKILL.md) |
| Request/response (RPC) — `channel.request(...)` + `channel.respond(...)` for synchronous-style calls over a message bus | [`@warlock.js/herald/request-and-respond/SKILL.md`](@warlock.js/herald/request-and-respond/SKILL.md) |
| Schema-validated channels — `.channel(name, { schema })` with `@warlock.js/seal` | See [`@warlock.js/seal/seal-basics/SKILL.md`](@warlock.js/seal/seal-basics/SKILL.md) + skills below |

## Things NOT to do

- Don't `connectToBroker` from inside a request handler. Call once at boot.
- Don't catch a handler error and swallow it — under smart auto-ack a thrown handler auto-nacks (re-delivers), but a caught-and-ignored error looks like success and gets auto-acked, silently dropping the work. Either let it throw or call `ctx.reject()` / `ctx.nack(false)` deliberately.
- Don't use `autoAck: true` in production. The default smart auto-ack re-delivers on a mid-handling crash; `autoAck: true` acks on delivery, so a crash loses the message.
- Don't share a typed channel across producer and consumer code without a shared type / schema file. Drift between sides causes silent payload corruption.

## See also

- README at `@warlock.js/herald/README.md` for the full API surface and RabbitMQ / Kafka driver config
- [`@warlock.js/seal/seal-basics/SKILL.md`](@warlock.js/seal/seal-basics/SKILL.md) — schema validation
