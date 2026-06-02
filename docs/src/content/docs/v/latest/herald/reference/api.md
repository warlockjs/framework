---
title: "API reference"
description: Public exports from @warlock.js/herald — functions, classes, types, contracts.
sidebar:
  order: 1
  label: "API reference"
---

Every public export from `@warlock.js/herald`. For task-oriented usage, start with the [guides](../guides/publish-message.md).

```ts
import {
  connectToBroker,
  herald,
  heraldChannel,
  publishEvent,
  subscribeConsumer,
  brokerRegistry,
  Broker,
  MissingBrokerError,
  EventMessage,
  EventConsumer,
  defineEvent,
  defineConsumer,
  Consumable,
  RabbitMQDriver,
} from "@warlock.js/herald";
```

## Top-level functions

| Export | Signature | Purpose |
| --- | --- | --- |
| `connectToBroker` | `(options: ConnectionOptions) => Promise<Broker>` | Open a connection, register the broker, return it. Call once at boot. |
| `herald` | `(name?: string) => Broker` | Resolve a broker by name (default if omitted). Throws `MissingBrokerError` if not found. |
| `heraldChannel<TPayload>` | `(name, options?) => ChannelContract<TPayload>` | Shorthand for `herald().channel(name, options)`. |
| `publishEvent<TPayload>` | `(event: EventMessage<TPayload>) => Promise<void>` | Publish an `EventMessage` instance via the default broker. |
| `subscribeConsumer<TPayload>` | `(Consumer: EventConsumerClass<TPayload>) => Promise<() => void>` | Subscribe an `EventConsumer` class to the default broker. Returns an unsubscribe function. |

## Broker registry

`brokerRegistry` is the global singleton holding every registered broker.

| Method | Purpose |
| --- | --- |
| `register(options)` | Add a broker to the registry (called by `connectToBroker`). |
| `get(name?)` | Resolve a broker; throws `MissingBrokerError` if missing. |
| `has(name)` | Boolean — is this broker registered? |
| `hasAny()` | Boolean — any brokers at all? |
| `getAll()` | Array of every registered broker. |
| `getNames()` | Array of broker names. |
| `getDefault()` | The default broker, or `undefined`. |
| `on(event, listener)` | Listen for `"registered"` / `"default-registered"` / `"connected"` / `"disconnected"`. |
| `off(event, listener)` / `once(event, listener)` | Standard event-emitter pair. |
| `clear()` | Drop every broker — only for tests. |

## `Broker`

Returned by `connectToBroker` and `herald()`. Wraps a driver with metadata.

| Property / method | Type / signature | Purpose |
| --- | --- | --- |
| `name` | `string` | Broker name (registry key). |
| `isDefault` | `boolean` | Whether this is the default broker. |
| `isConnected` | `boolean` | Live status — proxies the driver. |
| `driver` | `BrokerDriverContract` | The underlying driver. Escape hatch for raw AMQP access. |
| `channel<TPayload>(name, options?)` | `ChannelContract<TPayload>` | Get or create a channel. Cached after first call. |
| `publish<TPayload>(event)` | `void` | Publish an `EventMessage` (channel name = `event.eventName`). |
| `subscribe(consumer)` | `() => void` | Subscribe an `EventConsumer` class. Returns an unsubscribe function. |
| `connect()` / `disconnect()` | `Promise<void>` | Lifecycle. |
| `startConsuming()` / `stopConsuming()` | `Promise<void>` | Batch consumer control. |
| `healthCheck()` | `Promise<HealthCheckResult>` | Round-trip liveness + latency. |

## `ChannelContract<TPayload>`

Returned by `broker.channel(name)`. Driver-agnostic pub/sub interface.

| Method | Signature | Purpose |
| --- | --- | --- |
| `publish` | `(payload, options?: PublishOptions) => Promise<void>` | Send a single message. |
| `publishBatch` | `(payloads[], options?) => Promise<void>` | Send many — same options to each. |
| `subscribe` | `(handler, options?: SubscribeOptions) => Promise<Subscription>` | Register a consumer. |
| `unsubscribeById` | `(consumerId) => Promise<void>` | Cancel a specific subscription. |
| `request<TResponse>` | `(payload, options?: RequestOptions) => Promise<TResponse>` | RPC — publish and await reply. |
| `respond<TResponse>` | `(handler) => Promise<Subscription>` | Register an RPC responder. |
| `stats` | `() => Promise<ChannelStats>` | `{ messageCount, consumerCount, name }`. |
| `purge` | `() => Promise<number>` | Drop all pending messages. Returns count purged. |
| `exists` | `() => Promise<boolean>` | Does the queue exist on the broker? |
| `delete` | `() => Promise<void>` | Remove queue + cancel subscriptions. |
| `assert` | `() => Promise<void>` | Force assert (lazy by default). |
| `stopConsuming` | `() => Promise<void>` | Cancel all subscriptions on this channel. |

## Connection options

```ts
type ConnectionOptions = RabbitMQConnectionOptions | KafkaConnectionOptions;
```

`RabbitMQConnectionOptions` carries: `driver: "rabbitmq"`, `host`, `port`, `username`, `password`, `vhost`, `uri`, `heartbeat`, `connectionTimeout`, `reconnect`, `reconnectDelay`, `prefetch`, `clientOptions`, plus the registry fields `name` and `isDefault`. See [connection-and-config](../essentials/02-connection-and-config.md) for the full table.

`KafkaConnectionOptions` is declared but throws at connect — Kafka driver is not yet implemented.

## Channel options

```ts
type ChannelOptions<TPayload> = {
  type?: "queue" | "topic" | "fanout";
  durable?: boolean;
  autoDelete?: boolean;
  exclusive?: boolean;
  deadLetter?: DeadLetterOptions;
  maxMessageSize?: number;
  messageTtl?: number;
  maxLength?: number;
  schema?: BaseValidator;
};
```

Today's RabbitMQ driver consumes `durable`, `autoDelete`, `exclusive`, `messageTtl`, `maxLength`, `deadLetter`, and `schema`. The `type` field and `maxMessageSize` are declared for future exchange-shape support.

## Publish options

```ts
type PublishOptions = {
  priority?: number;
  ttl?: number;
  delay?: number;
  headers?: Record<string, string>;
  persistent?: boolean;
  correlationId?: string;
  expiration?: number;
};

type RequestOptions = PublishOptions & { timeout?: number };
```

See [publish-message](../guides/publish-message.md#publish-options) for what each field does on RabbitMQ.

## Subscribe options

```ts
type SubscribeOptions = {
  consumerId?: string;
  group?: string;
  prefetch?: number;
  autoAck?: boolean;
  retry?: RetryOptions;
  deadLetter?: DeadLetterOptions;
  exclusive?: boolean;
};

type RetryOptions = {
  maxRetries: number;
  delay: number | ((attempt: number) => number);
};

type DeadLetterOptions = {
  channel: string;
  preserveOriginal?: boolean;
};
```

See [consume-message](../guides/consume-message.md#subscribe-options).

## Message envelope

```ts
type Message<TPayload> = {
  readonly metadata: MessageMetadata;
  readonly payload: TPayload;
  readonly raw?: unknown;
};

type MessageMetadata = {
  messageId: string;
  correlationId?: string;
  replyTo?: string;
  priority?: number;
  timestamp: Date;
  headers?: Record<string, string>;
  retryCount?: number;
  originalChannel?: string;
};

type MessageContext = {
  ack(): Promise<void>;
  nack(requeue?: boolean): Promise<void>;
  reject(): Promise<void>;
  reply<T>(payload: T): Promise<void>;
  retry(delay?: number): Promise<void>;
};
```

## Subscription handle

```ts
type Subscription = {
  readonly id: string;
  readonly channel: string;
  readonly consumerTag?: string;
  unsubscribe(): Promise<void>;
  pause(): Promise<void>;       // also cancels on RabbitMQ
  resume(): Promise<void>;       // throws on RabbitMQ — re-subscribe instead
  isActive(): boolean;
};
```

## Class-based consumers

| Export | Purpose |
| --- | --- |
| `EventMessage<TPayload>` | Abstract base for event classes — `eventName`, `version`, `schema`, `toJSON()`, `serialize()`. |
| `EventConsumer<Payload>` | Abstract base for consumer classes — `eventName` (static), `schema`, `handle(payload, event)`. |
| `defineEvent(name, options?)` | Factory — returns an `EventMessage` subclass. |
| `defineConsumer(name, options)` | Factory — registers a consumer + returns the class. |
| `Consumable(options?)` | Decorator — registers an `EventConsumer` subclass with the broker. |
| `publishEvent(event)` | Publish an `EventMessage` instance. |
| `subscribeConsumer(Consumer)` | Subscribe an `EventConsumer` class. |

## Errors

| Class | Thrown when |
| --- | --- |
| `MissingBrokerError` | `herald(name)` resolves to an unregistered broker, or no default exists. |

Connection failures throw `Error` with a `"Failed to connect to rabbitmq: ..."` prefix. Schema validation failures throw `Error` with `"Message validation failed: ..."`.
