# `@warlock.js/herald` — backlog

Findings from the release-quality polish pass (skills verification, test
authoring, docs enrichment). Newest first.

## Behavior bugs / gaps (NOT fixed — changing them alters runtime behavior)

These were left in place per the "fix only if behavior-preserving; else log"
rule. Each needs a deliberate decision before a fix ships.

### 1. `RetryOptions.delay` is dead on the automatic throw path

`subscribe.types.ts` declares `delay: number | ((attempt: number) => number)`,
implying configurable (incl. exponential) backoff. But the subscribe error
handler in `rabbitmq-channel.ts` (the `catch` around lines 273–293) **never
reads `options.retry.delay`** — on a thrown handler it only checks
`retryCount < maxRetries` and calls `nack(msg, false, true)` (immediate
requeue). The function-form `delay` is never invoked anywhere in `src` (grep:
no `.delay(` / `delay(attempt` call sites).

The only delay that takes effect is the **manual** `ctx.retry(delayMs)` path,
which sets an `x-delay` header — and that itself needs the RabbitMQ
delayed-message-exchange plugin.

**Decision needed:** either (a) wire `retry.delay` into the throw path (compute
delay, republish with `x-delay`, ack original — mirroring `ctx.retry`), or
(b) narrow the type to `delay?: number` and document it as "manual-only / hint."
Docs + skills were corrected to describe current reality in the meantime.

### 2. `prefetch` is channel-global, not per-consumer

The driver shares ONE AMQP channel across every herald channel on a broker
(`rabbitmq-driver.ts` `amqpChannel`). `subscribe`'s `prefetch` calls that shared
channel's `prefetch(n)`, so the last writer wins for the whole connection — it
is not isolated per subscriber. Docs/skills describe it as a "per-consumer cap."
A note was added to the consume guide; a true per-consumer model would require
one AMQP channel per consumer.

### 3. `respond()` cannot select a consumer group

`ChannelContract.respond(handler)` takes no options, so RPC responders can't set
a `group`/`consumerTag` or prefetch. Multiple responders simply round-robin on
the shared queue. If responder-pool tuning is wanted, `respond` needs an options
arg (mirroring `subscribe`). Skill/guide framing corrected to match the API.

### 4. `assert()` ignores `deadLetterExchange` wiring nuance

`rabbitmq-channel.ts` `assert()` sets `deadLetterExchange: ""` +
`deadLetterRoutingKey: this.options.deadLetter?.channel`. DLQ on retry-exhaustion
is herald-managed (explicit `sendToQueue` to the DLQ channel), so broker-native
`x-dead-letter-exchange` semantics (routing-key rewrite, TTL-on-DLQ) aren't
fully surfaced. Documented as a known limitation; revisit if native DLX routing
is requested.

### 5. `ChannelOptions.type` / `maxMessageSize` are declared but unused

The RabbitMQ driver consumes `durable`, `autoDelete`, `exclusive`, `messageTtl`,
`maxLength`, `deadLetter`, `schema`. `type: "queue" | "topic" | "fanout"` and
`maxMessageSize` are inert today (exchange-shape support is future work).
Reference doc already flags this.

## Accuracy fixes applied this pass (skills + docs)

- **publish-message skill** — removed the false "Single round-trip to the
  broker" claim for `publishBatch` (it loops `await publish()` per message).
- **consume-message skill** — corrected the retry section: function-form
  `delay`/"exponential 1s,2s,3s…" was fiction; added the throw-path caveat.
  Fixed `@Consumable` wiring claim (`warlock.config.ts` → self-registers on
  import; framework reads `src/config/herald.ts`).
- **request-and-respond skill** — replaced the "same group / different group"
  framing (`respond` has no group knob) with the real round-robin behavior.
- **consume guide** — retry section rewritten with a `:::caution` on `delay`;
  added a `:::note` on the shared-AMQP-channel prefetch nuance.
- **handle-errors guide** — corrected the `retry.delay` "passed through x-delay"
  framing; showed handler-driven `ctx.retry()` backoff as the real path.
- **dead-letter recipe** — `delay: (attempt) => …` replaced with `delay: 0` +
  an inline note that delay is inert on the throw path.
- **connection-and-config essential** — "exponential-ish retry loop" → fixed
  constant-interval reconnect (no backoff).
- **introduction** — added a 15-line publish→consume dive-in on the entry page.
- **index landing** — replaced "Diátaxis still being written" with a real
  read-by-intent map.

## Test coverage

Added `vitest.config.ts` (aliases `@warlock.js/seal` + `@warlock.js/logger` to
their TS source since those packages ship only unbuilt `cjs/`) and 7 test files
under `tests/` — **61 tests, all green**, no live broker (amqplib mocked /
injected fake channel):

- `broker-registry.test.ts` — default resolution, named lookup, `MissingBrokerError`,
  event forwarding, membership.
- `event-message.test.ts` — `serialize()` envelope, messageId generation,
  no-data throw, `defineEvent` toJSON projection.
- `event-consumer.test.ts` — `isAcceptedVersion` bounds, stable `consumerId`.
- `prepare-consumer-subscription.test.ts` — success ack, version reject,
  schema-fail nack, coerced-data handoff, throw → nack(true) + onError.
- `rabbitmq-channel.test.ts` — lazy assert, envelope/routing, publish-option
  mapping, `x-delay`, publishBatch fan-out, smart ack/nack, schema reject,
  `ctx.retry` x-retry-count increment, DLQ send, `ctx.reply` correlation.
- `request-respond.test.ts` — correlationId match/ignore, timeout rejection,
  `respond` reply value.
- `rabbitmq-driver.test.ts` — connect/URL build/uri precedence, failure
  wrapping, channel caching, EventMessage publish (double-wrap envelope),
  deferred-consumer subscribe-on-connect.

### Coverage gaps requiring a live broker (skipped — documented)

- Real reconnect loop (`handleReconnect` timers + re-subscribe on `close`).
- `healthCheck` round-trip against `amq.rabbitmq.reply-to`.
- Actual AMQP delivery ordering, prefetch backpressure, persistence across
  restart, real `x-delay` plugin behavior.

These are integration concerns; a future `tests/integration/` suite gated behind
a Dockerized RabbitMQ (skipped when unavailable) would cover them.
