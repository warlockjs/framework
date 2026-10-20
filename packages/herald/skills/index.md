---
description: 'Broker messaging over RabbitMQ: `connectToBroker`, `herald`, `heraldChannel`, `defineEvent`, `defineConsumer`, `EventMessage` and `EventConsumer`. Use for "publish an event", "subscribe to a channel", "ack or nack", "request and reply" or cross-service pub/sub. Not this package → @warlock.js/queue for durable retried background jobs; @warlock.js/scheduler for cron; @warlock.js/notifications for user notifications.'
---

# @warlock.js/herald

Herald is the broker-agnostic message bus. `connectToBroker(config)` boots a broker once; `herald()` returns it (`herald("name")` for a named one); `.channel(name)` is the queue/topic you publish into and subscribe from. Channels are typed with generics and can validate with a seal schema. Server-only.

## The 80% path

1. Orient with `herald-basics.md` (the map and foundations).
2. Connect at startup, then publish: `publish-message.md`.
3. Consume with `subscribe` handlers or consumer classes: `consume-message.md`.
4. Need a reply? `request-and-respond.md`.

## Conventions and pitfalls

- Call `connectToBroker` once before any publish or subscribe.
- Smart auto-ack is the default: a clean return acks, a throw nacks with requeue. `autoAck: true` loses messages on a crash; avoid it.
- Use `ctx.reject()` / `ctx.retry(ms)` only for a non-default outcome.
- Herald is transport, not a job runner: no retries-as-jobs, no scheduling. Use `@warlock.js/queue` for retried jobs, `@warlock.js/scheduler` for cron.
- Install the driver (`amqplib`) yourself; Kafka is not shipped yet.
- Do not value-import from client code.
