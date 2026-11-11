import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

/**
 * A fake connection that behaves like amqplib's: closing it, from either side,
 * emits `close`.
 */
class ClosingConnection extends EventEmitter {
  public readonly channel = new FakeAmqpChannel();
  public readonly createChannel = vi.fn(async () => this.channel);
  public readonly close = vi.fn(async () => {
    this.emit("close");
  });
}

const connectMock = vi.fn();

vi.mock("amqplib", () => ({
  connect: (...args: unknown[]) => connectMock(...args),
}));

const { RabbitMQDriver } = await import("../src/drivers/rabbitmq/rabbitmq-driver");

describe("RabbitMQDriver — disconnect and reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connectMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a deliberate disconnect() never schedules a reconnect", async () => {
    const connection = new ClosingConnection();
    connectMock.mockResolvedValue(connection);
    const driver = new RabbitMQDriver({ driver: "rabbitmq", reconnectDelay: 1_000 });
    const onReconnecting = vi.fn();
    const onDisconnected = vi.fn();
    driver.on("reconnecting", onReconnecting);

    await driver.connect();
    driver.on("disconnected", onDisconnected);
    await driver.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(onReconnecting).not.toHaveBeenCalled();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnect() during a pending reconnect cancels it", async () => {
    const connection = new ClosingConnection();
    connectMock.mockResolvedValue(connection);
    const driver = new RabbitMQDriver({ driver: "rabbitmq", reconnectDelay: 1_000 });

    await driver.connect();
    connection.emit("close"); // the broker went away
    await driver.disconnect();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("after a broker-side close, channels publish and consume on the new AMQP channel", async () => {
    const first = new ClosingConnection();
    const second = new ClosingConnection();
    connectMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const driver = new RabbitMQDriver({ driver: "rabbitmq", reconnectDelay: 1_000 });

    await driver.connect();
    const handler = vi.fn(async () => undefined);
    await driver.channel<{ id: number }>("orders").subscribe(handler);

    first.emit("close");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(driver.isConnected).toBe(true);

    await driver.channel<{ id: number }>("orders").publish({ id: 1 });

    expect(first.channel.sent).toHaveLength(0);
    expect(second.channel.sent).toHaveLength(1);
    expect(second.channel.assertedQueues.map((entry) => entry.name)).toContain("orders");

    // The consumer was re-attached on the new channel.
    await second.channel.deliver(second.channel.buildDelivery({ id: 1 }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.channel.ack).toHaveBeenCalledTimes(1);
  });

  it("a channel created before connect() publishes once connected", async () => {
    const connection = new ClosingConnection();
    connectMock.mockResolvedValue(connection);
    const driver = new RabbitMQDriver({ driver: "rabbitmq", reconnect: false });
    const early = driver.channel<{ id: number }>("early");

    await driver.connect();
    await early.publish({ id: 1 });

    expect(connection.channel.sent[0]?.queue).toBe("early");
  });
});
