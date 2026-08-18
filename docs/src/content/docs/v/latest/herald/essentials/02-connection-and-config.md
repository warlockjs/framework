---
title: "Connection and config"
description: How herald connects to RabbitMQ, what the connection options mean, multi-broker setups, and how reconnects behave after a broker restart.
sidebar:
  order: 2
  label: "Connection and config"
---

`connectToBroker` is herald's one bootstrap call. It instantiates the driver, opens a connection, registers the broker in herald's in-memory registry, and returns the `Broker` instance. Call it once per broker at app startup — before any code that publishes or subscribes runs.

## The shape

```ts
import { connectToBroker } from "@warlock.js/herald";

await connectToBroker({
  driver: "rabbitmq",
  host: "localhost",
  port: 5672,
  username: "guest",
  password: "guest",
});
```

All RabbitMQ-side options:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `driver` | `"rabbitmq"` | required | Driver discriminator. `"kafka"` throws "not yet implemented". |
| `host` | `string` | `"localhost"` | RabbitMQ host. |
| `port` | `number` | `5672` | AMQP port. |
| `username` | `string` | `"guest"` | RabbitMQ user. |
| `password` | `string` | `"guest"` | RabbitMQ password. |
| `vhost` | `string` | `"/"` | RabbitMQ virtual host. URL-encoded for you. |
| `uri` | `string` | unset | If set, takes precedence over host / port / username / password / vhost. Use for `amqps://` URLs from managed providers. |
| `heartbeat` | `number` | `60` | AMQP heartbeat interval in seconds. |
| `connectionTimeout` | `number` | unset | Connection timeout in ms. |
| `prefetch` | `number` | unset | Per-AMQP-channel prefetch (concurrency cap). Subscribers can override per call. |
| `reconnect` | `boolean` | `true` | Auto-reconnect after connection close. |
| `reconnectDelay` | `number` | `5000` | Delay between reconnect attempts, in ms. |
| `name` | `string` | `"default"` | Broker name in the registry. |
| `isDefault` | `boolean` | `true` | Whether `herald()` (no name) resolves to this broker. |
| `clientOptions` | `RabbitMQClientOptions` | unset | Pass-through to amqplib — frame size, locale, TLS socket options. |

## URI vs host/port

Most managed providers (CloudAMQP, AWS MQ, etc.) give you a URI:

```ts
await connectToBroker({
  driver: "rabbitmq",
  uri: process.env.RABBITMQ_URI,
  // amqps://user:pass@host.cloudamqp.com/vhost
});
```

When `uri` is set, the other connection fields are ignored — herald passes the URI straight to amqplib. Useful when the provider gives you exotic TLS or auth setups.

**Credentials never leak into a connection error.** Whether you pass `username`/`password` or a full `uri`, a failed connect has `user:pass@` redacted before the error is thrown — safe to log or forward to an error tracker as-is. (`username`/`password` are also URI-encoded when herald builds the internal `amqp://` URL, so a reserved character in a generated secret can't produce a malformed URL that echoes the raw credential back.)

## TLS

For `amqps://`, either pass the URI directly (as above) or thread certs through `clientOptions.socket`:

```ts
import { readFileSync } from "node:fs";

await connectToBroker({
  driver: "rabbitmq",
  host: "secure.example.com",
  port: 5671,
  username: process.env.RABBITMQ_USER,
  password: process.env.RABBITMQ_PASSWORD,
  clientOptions: {
    socket: {
      ca: [readFileSync("ca.pem")],
      cert: readFileSync("client.pem"),
      key: readFileSync("client.key"),
      rejectUnauthorized: true,
    },
  },
});
```

## Multi-broker

Run two brokers (or more) side by side — typical when one cluster handles notifications and another handles analytics:

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
  host: process.env.ANALYTICS_HOST,
});

// Default broker — resolves to "notifications"
herald().channel("emails").publish({ /* ... */ });

// Named broker
herald("analytics").channel("events").publish({ /* ... */ });
```

`isDefault: true` on the first registration is implicit (the first broker registered becomes the default if none has been declared yet). Set `isDefault: false` on a broker that should never be the default — useful when you want to force code to be explicit about which broker it uses.

`herald("analytics")` throws `MissingBrokerError` if no broker with that name is registered. Catch it during boot if you want a defensive error rather than a runtime crash.

## Connect at boot, never in a handler

Treat `connectToBroker` as bootstrap code, full stop. Don't call it inside an HTTP handler, a cron job, or a worker loop:

```ts
// ❌ Don't do this
app.post("/users", async (req, res) => {
  await connectToBroker({ /* ... */ });   // re-connects every request
  await herald().channel("user.created").publish(req.body);
});

// ✅ Connect once at boot
await connectToBroker({ /* ... */ });

app.post("/users", async (req, res) => {
  await herald().channel("user.created").publish(req.body);
});
```

The cost of `connectToBroker` is a TCP handshake plus AMQP channel setup. Doing it per request is wasteful and you'll exhaust the broker's connection pool fast.

## Reconnects

When `reconnect: true` (the default), the RabbitMQ driver listens for the connection's `close` event and starts a fixed-interval retry loop — every `reconnectDelay` ms (default 5000) it attempts to reconnect. There's no backoff: the interval stays constant. Failed attempts retry indefinitely; a successful attempt re-emits `connected` and re-registers any pending consumers.

What this means in practice:

- **Broker restart** — your app reconnects and resumes consuming once RabbitMQ is back. Messages published during the gap fail (the producer-side `publish` will throw), but consumers pick up where they left off.
- **Network blip** — same story. Heartbeats detect the dead socket; the close handler triggers reconnect.
- **Indefinite retries** — herald keeps trying forever. If the broker is misconfigured at boot time, this can mask a real problem; subscribe to the `disconnected` event or watch logs if you want to alarm on extended outages.

To disable reconnects (rare, but useful in some test setups):

```ts
await connectToBroker({
  driver: "rabbitmq",
  reconnect: false,
  // ...
});
```

## Listen for lifecycle events

The broker registry emits `registered`, `default-registered`, `connected`, `disconnected`:

```ts
import { brokerRegistry } from "@warlock.js/herald";

brokerRegistry.on("connected", (broker) => {
  console.log(`Broker "${broker.name}" connected`);
});

brokerRegistry.on("disconnected", (broker) => {
  console.warn(`Broker "${broker.name}" disconnected`);
  // wire your alerting here
});
```

Or directly on the broker's driver:

```ts
const broker = await connectToBroker({ /* ... */ });

broker.driver.on("reconnecting", (attempt) => {
  console.log(`Reconnect attempt #${attempt}`);
});

broker.driver.on("error", (error) => {
  console.error("Driver error:", error);
});
```

## Graceful shutdown

On `SIGTERM` / `SIGINT`, stop consuming and close the connection cleanly so in-flight messages don't sit half-handled:

```ts
import { brokerRegistry } from "@warlock.js/herald";

async function shutdown() {
  for (const broker of brokerRegistry.getAll()) {
    await broker.stopConsuming();   // cancel all consumer tags
    await broker.disconnect();      // close AMQP channel + connection
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

`stopConsuming` cancels every consumer on every channel before tearing down the connection. Messages currently in your handler complete; new ones stay in the queue for the next instance to pick up.

## Next

- [Publish messages](../guides/publish-message.md) — options, batches, schemas.
- [Consume messages](../guides/consume-message.md) — workers, retries, dead-letter.
