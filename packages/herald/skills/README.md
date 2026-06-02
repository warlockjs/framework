# `@warlock.js/herald` — skills index

Per-task skills. All cross-references use the form `@warlock.js/<pkg>/<skill>/SKILL.md`.

## Skills

### [`consume-message/`](./consume-message/SKILL.md)

Subscribe to a channel via .subscribe(handler, options?) — handler receives (message, ctx). Control flow via ctx.ack / ctx.nack(requeue?) / ctx.reject / ctx.retry(delayMs). Configure prefetch, retry policy, dead-letter, consumer groups. Load when implementing a worker processing events, a queue background processor, or consuming an event log.

### [`herald-basics/`](./herald-basics/SKILL.md)

Start with @warlock.js/herald — connectToBroker config, herald() factory, channel concept, multi-broker support. Load when wiring connectToBroker at boot, choosing a herald skill, or wiring multiple brokers (notifications + analytics + events).

### [`publish-message/`](./publish-message/SKILL.md)

Publish messages to a channel — .publish(payload, options?) for single, .publishBatch([...], options?) for batch, with priority / ttl / delay / persistent / correlationId / headers options. Optional schema validation via .channel(name, {schema}). Load when emitting an event after a domain change, fanning out a notification, or scheduling delayed work.

### [`request-and-respond/`](./request-and-respond/SKILL.md)

Synchronous-style RPC over the message bus — channel.request<R>(payload, {timeout}) waits for a reply, channel.respond(handler) registers the responder, ctx.reply(response) sends the answer. Load when needing a request-response shape across services with loose coupling instead of direct HTTP.
