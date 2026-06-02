import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

/**
 * Fake AMQP connection returned by the mocked `amqplib.connect`. Behaves like an
 * EventEmitter (the driver listens for `close` / `error`) and hands out a single
 * `FakeAmqpChannel`.
 */
class FakeConnection extends EventEmitter {
  public readonly channel = new FakeAmqpChannel();
  public readonly createChannel = vi.fn(async () => this.channel);
  public readonly close = vi.fn(async () => undefined);
}

const connectMock = vi.fn();

vi.mock("amqplib", () => ({
  connect: (...args: unknown[]) => connectMock(...args),
}));

// Imported after the mock is registered so the driver's lazy `import("amqplib")`
// resolves to the mock.
const { RabbitMQDriver } = await import("../src/drivers/rabbitmq/rabbitmq-driver");
const { EventConsumer } = await import("../src/message-managers/event-consumer");

describe("RabbitMQDriver — connection", () => {
  let connection: FakeConnection;

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects, flips isConnected, and emits connected", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });
    const onConnected = vi.fn();

    driver.on("connected", onConnected);

    await driver.connect();

    expect(driver.isConnected).toBe(true);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(connection.createChannel).toHaveBeenCalledTimes(1);
  });

  it("builds a default amqp URL from host/port/credentials", async () => {
    const driver = new RabbitMQDriver({
      driver: "rabbitmq",
      host: "rabbit.internal",
      port: 5673,
      username: "app",
      password: "secret",
    });

    await driver.connect();

    expect(connectMock).toHaveBeenCalledWith(
      "amqp://app:secret@rabbit.internal:5673/%2F",
      expect.objectContaining({ heartbeat: 60 }),
    );
  });

  it("prefers an explicit uri over discrete fields", async () => {
    const driver = new RabbitMQDriver({
      driver: "rabbitmq",
      uri: "amqps://user:pw@cloud.example.com/prod",
    });

    await driver.connect();

    expect(connectMock).toHaveBeenCalledWith(
      "amqps://user:pw@cloud.example.com/prod",
      expect.anything(),
    );
  });

  it("wraps a connection failure with a descriptive error", async () => {
    connectMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await expect(driver.connect()).rejects.toThrow(/Failed to connect to RabbitMQ: ECONNREFUSED/);
    expect(driver.isConnected).toBe(false);
  });

  it("emits disconnected on graceful disconnect", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost", reconnect: false });
    const onDisconnected = vi.fn();

    await driver.connect();
    driver.on("disconnected", onDisconnected);

    await driver.disconnect();

    expect(driver.isConnected).toBe(false);
    expect(onDisconnected).toHaveBeenCalled();
  });
});

describe("RabbitMQDriver — channels", () => {
  let connection: FakeConnection;

  beforeEach(async () => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  it("caches channels by name", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    const first = driver.channel("orders");
    const second = driver.channel("orders");

    expect(first).toBe(second);
    expect(driver.getChannelNames()).toEqual(["orders"]);
  });

  it("publishes an EventMessage to a channel named after its eventName", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    const { EventMessage } = await import("../src/message-managers/event-message");

    class OrderCreated extends EventMessage<{ orderId: number }> {
      public eventName = "order.created";
    }

    driver.publish(new OrderCreated({ orderId: 1 }));

    // driver.publish is fire-and-forget — the underlying channel.publish asserts
    // then sends asynchronously, so let the microtask queue drain first.
    await new Promise((resolve) => setImmediate(resolve));

    // The driver shares one amqp channel; the message lands on the "order.created" queue.
    const sent = connection.channel.sent.find((entry) => entry.queue === "order.created");

    expect(sent).toBeDefined();

    // driver.publish hands the serialized EventMessage to channel.publish as the
    // payload, so the channel envelope's `payload` is the full event envelope —
    // and `payload.payload` is the original data the consumer ultimately reads.
    const channelEnvelope = JSON.parse(sent!.content.toString());
    const eventEnvelope = channelEnvelope.payload;

    expect(eventEnvelope.eventName).toBe("order.created");
    expect(eventEnvelope.payload).toEqual({ orderId: 1 });
    expect(eventEnvelope.__through).toBe("EventMessage");
  });
});

describe("RabbitMQDriver — deferred consumers", () => {
  let connection: FakeConnection;

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  it("queues consumers registered before connect and subscribes them on connect", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    class PreConnectConsumer extends EventConsumer {
      public static eventName = "pre.connect";
      public async handle() {}
    }

    // Subscribing before connect should buffer, not register an AMQP consumer.
    driver.subscribe(PreConnectConsumer as never);

    expect(connection.channel.assertedQueues).toHaveLength(0);

    await driver.connect();

    // connect() drains buffered consumers via the async channel.subscribe path;
    // let those assert microtasks settle before inspecting.
    await new Promise((resolve) => setImmediate(resolve));

    // After connect, the buffered consumer is wired to its queue.
    const asserted = connection.channel.assertedQueues.find(
      (entry) => entry.name === "pre.connect",
    );

    expect(asserted).toBeDefined();
  });

  it("subscribes immediately and assigns the consumerId when already connected", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    const consumeSpy = vi.spyOn(connection.channel, "consume");

    class LiveConsumer extends EventConsumer {
      public static eventName = "live.event";
      public async handle() {}
    }

    driver.subscribe(LiveConsumer as never);

    await new Promise((resolve) => setImmediate(resolve));

    const asserted = connection.channel.assertedQueues.find((entry) => entry.name === "live.event");
    expect(asserted).toBeDefined();

    const consumeOptions = consumeSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(consumeOptions.consumerTag).toBe(LiveConsumer.consumerId);
  });

  it("returns an unsubscribe handle that removes a buffered consumer before connect", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    class BufferedConsumer extends EventConsumer {
      public static eventName = "buffered.event";
      public async handle() {}
    }

    const unsubscribe = driver.subscribe(BufferedConsumer as never);
    expect(driver.consumers).toContain(BufferedConsumer);

    unsubscribe();

    expect(driver.consumers).not.toContain(BufferedConsumer);

    // Now connecting must not wire the removed consumer to a queue.
    await driver.connect();
    await new Promise((resolve) => setImmediate(resolve));

    expect(connection.channel.assertedQueues.some((entry) => entry.name === "buffered.event")).toBe(
      false,
    );
  });

  it("unsubscribe cancels the live consumer when connected", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    class LiveConsumer extends EventConsumer {
      public static eventName = "cancel.event";
      public async handle() {}
    }

    driver.subscribe(LiveConsumer as never);
    await new Promise((resolve) => setImmediate(resolve));

    driver.unsubscribe(LiveConsumer as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(connection.channel.cancel).toHaveBeenCalled();
  });
});

describe("RabbitMQDriver — health check", () => {
  let connection: FakeConnection;

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unhealthy with a reason when not connected", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    const result = await driver.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("Not connected to RabbitMQ");
  });

  it("reports healthy with a latency once connected", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    const result = await driver.healthCheck();

    expect(result.healthy).toBe(true);
    expect(typeof result.latency).toBe("number");
  });

  it("reports unhealthy when the channel probe throws synchronously", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    // A synchronous throw escapes the inner `.catch` and surfaces as unhealthy.
    vi.spyOn(connection.channel, "checkQueue").mockImplementation(() => {
      throw new Error("channel closed");
    });

    const result = await driver.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("channel closed");
  });
});

describe("RabbitMQDriver — channel management", () => {
  let connection: FakeConnection;

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  it("applies the configured prefetch on connect", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost", prefetch: 50 });

    await driver.connect();

    expect(connection.channel.prefetch).toHaveBeenCalledWith(50);
  });

  it("closeChannel deletes the queue and drops it from the channel registry", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    driver.channel("temp");
    expect(driver.getChannelNames()).toContain("temp");

    await driver.closeChannel("temp");

    expect(connection.channel.deleteQueue).toHaveBeenCalledWith("temp");
    expect(driver.getChannelNames()).not.toContain("temp");
  });

  it("closeChannel is a no-op for an unknown channel", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    await expect(driver.closeChannel("never-created")).resolves.toBeUndefined();
    expect(connection.channel.deleteQueue).not.toHaveBeenCalled();
  });

  it("stopConsuming cancels consumers across all channels", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    class Worker extends EventConsumer {
      public static eventName = "work.event";
      public async handle() {}
    }

    driver.subscribe(Worker as never);
    await new Promise((resolve) => setImmediate(resolve));

    await driver.stopConsuming();

    expect(connection.channel.cancel).toHaveBeenCalled();
  });

  it("exposes the raw channel and connection after connect", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    expect(driver.getRawChannel()).toBe(connection.channel);
    expect(driver.getRawConnection()).toBe(connection);
  });

  it("startConsuming resolves without error", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost" });

    await driver.connect();

    await expect(driver.startConsuming()).resolves.toBeUndefined();
  });
});

describe("RabbitMQDriver — connection close", () => {
  let connection: FakeConnection;

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flips isConnected and emits disconnected when the connection closes", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost", reconnect: false });
    const onDisconnected = vi.fn();
    const onReconnecting = vi.fn();

    await driver.connect();
    driver.on("disconnected", onDisconnected);
    driver.on("reconnecting", onReconnecting);

    connection.emit("close");

    expect(driver.isConnected).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    // reconnect is disabled, so no reconnect attempt is scheduled.
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it("forwards a connection error to the driver's error listeners", async () => {
    const driver = new RabbitMQDriver({ driver: "rabbitmq", host: "localhost", reconnect: false });
    const onError = vi.fn();

    await driver.connect();
    driver.on("error", onError);

    const failure = new Error("socket reset");
    connection.emit("error", failure);

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("schedules a reconnect attempt when the connection closes and reconnect is enabled", async () => {
    vi.useFakeTimers();

    try {
      const driver = new RabbitMQDriver({
        driver: "rabbitmq",
        host: "localhost",
        reconnectDelay: 1_000,
      });

      await driver.connect();

      const onReconnecting = vi.fn();
      driver.on("reconnecting", onReconnecting);

      // A fresh connection for the reconnect attempt to resolve against.
      const reconnectConnection = new FakeConnection();
      connectMock.mockResolvedValue(reconnectConnection);

      connection.emit("close");

      // The reconnect is deferred by reconnectDelay; advance past it.
      await vi.advanceTimersByTimeAsync(1_000);

      expect(onReconnecting).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
