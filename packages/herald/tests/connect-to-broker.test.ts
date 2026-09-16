import { EventEmitter } from "node:events";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrokerDriverContract } from "../src/contracts";
import { EventMessage } from "../src/message-managers/event-message";
import type { EventConsumerClass } from "../src/message-managers/types";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

/**
 * Fake AMQP connection handed back by the mocked `amqplib.connect`, matching the
 * surface the RabbitMQ driver touches on connect.
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

const { connectToBroker, herald, heraldChannel, publishEvent, subscribeConsumer } =
  await import("../src/utils/connect-to-broker");
const { brokerRegistry } = await import("../src/communicators");

describe("connectToBroker", () => {
  let connection: FakeConnection;

  // `connectToBroker` dynamically imports the rabbitmq driver on first use,
  // which drags in `@warlock.js/seal` and `@warlock.js/logger` as raw TS source
  // (see vitest.config.ts aliases). Pay that transform cost here instead of
  // inside the first timed test body. A cold transform measured 4.8s alone and
  // overran the 10s default hook timeout when every package's suite runs back
  // to back in the release gate.
  beforeAll(async () => {
    await import("../src/drivers/rabbitmq/rabbitmq-driver");
  }, 60_000);

  beforeEach(() => {
    connection = new FakeConnection();
    connectMock.mockReset();
    connectMock.mockResolvedValue(connection);
    brokerRegistry.clear();
  });

  afterEach(() => {
    brokerRegistry.clear();
    vi.restoreAllMocks();
  });

  it("registers and connects a rabbitmq broker with sensible defaults", async () => {
    const broker = await connectToBroker({ driver: "rabbitmq", host: "localhost" });

    expect(broker.name).toBe("default");
    expect(broker.isDefault).toBe(true);
    expect(broker.isConnected).toBe(true);
    expect(brokerRegistry.get("default")).toBe(broker);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("honours an explicit broker name and non-default flag", async () => {
    await connectToBroker({ driver: "rabbitmq", host: "localhost" });
    const analytics = await connectToBroker({
      driver: "rabbitmq",
      name: "analytics",
      isDefault: false,
      host: "localhost",
    });

    expect(analytics.name).toBe("analytics");
    expect(analytics.isDefault).toBe(false);
    expect(brokerRegistry.getDefault()?.name).toBe("default");
  });

  it("throws a not-implemented error for the kafka driver", async () => {
    await expect(connectToBroker({ driver: "kafka", brokers: ["localhost:9092"] })).rejects.toThrow(
      /Kafka driver is not yet implemented/,
    );
  });

  it("throws for an unknown driver", async () => {
    await expect(connectToBroker({ driver: "redis-streams" } as never)).rejects.toThrow(
      /Unknown driver: "redis-streams"/,
    );
  });

  it("wraps a connection failure with the driver name", async () => {
    connectMock.mockReset();
    connectMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      connectToBroker({ driver: "rabbitmq", host: "localhost", reconnect: false }),
    ).rejects.toThrow(/Failed to connect to rabbitmq:/);
  });
});

describe("herald helper functions", () => {
  /**
   * Fake driver exposing channel/publish/subscribe spies so the herald helpers'
   * delegation can be asserted without a live broker.
   */
  function createDelegatingDriver() {
    const channelPublish = vi.fn(async () => undefined);
    const channelObject = { publish: channelPublish, name: "ch" };
    const channel = vi.fn(() => channelObject);
    const publish = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);

    const driver = {
      name: "rabbitmq",
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      subscribe,
      unsubscribe: vi.fn(),
      publish,
      channel,
      startConsuming: vi.fn(),
      stopConsuming: vi.fn(),
      healthCheck: vi.fn(),
      getChannelNames: vi.fn(() => []),
      closeChannel: vi.fn(),
    } as unknown as BrokerDriverContract;

    return { driver, channel, channelObject, publish, subscribe, unsubscribe };
  }

  beforeEach(() => {
    brokerRegistry.clear();
  });

  afterEach(() => {
    brokerRegistry.clear();
  });

  it("herald() returns the default broker and herald(name) the named one", () => {
    const { driver: d1 } = createDelegatingDriver();
    const { driver: d2 } = createDelegatingDriver();

    const def = brokerRegistry.register({ name: "default", driver: d1 });
    const analytics = brokerRegistry.register({ name: "analytics", driver: d2 });

    expect(herald()).toBe(def);
    expect(herald("analytics")).toBe(analytics);
  });

  it("heraldChannel() resolves a channel from the default broker", () => {
    const { driver, channel, channelObject } = createDelegatingDriver();
    brokerRegistry.register({ name: "default", driver });

    const options = { durable: true };
    const result = heraldChannel("user.created", options);

    expect(channel).toHaveBeenCalledWith("user.created", options);
    expect(result).toBe(channelObject);
  });

  it("publishEvent() forwards an event message to the default broker's driver", async () => {
    const { driver, publish } = createDelegatingDriver();
    brokerRegistry.register({ name: "default", driver });

    class UserCreated extends EventMessage<{ id: number }> {
      public eventName = "user.created";
    }
    const event = new UserCreated({ id: 1 });

    await publishEvent(event);

    expect(publish).toHaveBeenCalledWith(event);
  });

  it("subscribeConsumer() forwards a consumer class to the default broker's driver", async () => {
    const { driver, subscribe, unsubscribe } = createDelegatingDriver();
    brokerRegistry.register({ name: "default", driver });

    const Consumer = class {} as unknown as EventConsumerClass;

    const handle = await subscribeConsumer(Consumer);

    expect(subscribe).toHaveBeenCalledWith(Consumer);
    expect(handle).toBe(unsubscribe);
  });
});
