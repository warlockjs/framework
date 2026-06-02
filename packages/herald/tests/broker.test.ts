import { describe, expect, it, vi } from "vitest";
import { Broker } from "../src/communicators/broker";
import type { BrokerDriverContract } from "../src/contracts";
import { EventMessage } from "../src/message-managers/event-message";
import type { EventConsumerClass } from "../src/message-managers/types";

/**
 * Fully spied driver so each `Broker` delegation can be asserted in isolation.
 */
function createDriver(overrides: Partial<BrokerDriverContract> = {}): BrokerDriverContract {
  return {
    name: "rabbitmq",
    isConnected: false,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    channel: vi.fn(),
    startConsuming: vi.fn(async () => undefined),
    stopConsuming: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ healthy: true })),
    getChannelNames: vi.fn(() => []),
    closeChannel: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as BrokerDriverContract;
}

describe("Broker", () => {
  it("stores name and driver and coerces isDefault to a boolean", () => {
    const driver = createDriver();

    const withDefault = new Broker({ name: "a", driver, isDefault: true });
    const withoutDefault = new Broker({ name: "b", driver });

    expect(withDefault.name).toBe("a");
    expect(withDefault.driver).toBe(driver);
    expect(withDefault.isDefault).toBe(true);
    expect(withoutDefault.isDefault).toBe(false);
  });

  it("delegates channel() to the driver", () => {
    const channelObject = { name: "orders" };
    const driver = createDriver({ channel: vi.fn(() => channelObject) as never });
    const broker = new Broker({ name: "a", driver });

    const options = { durable: true };
    const result = broker.channel("orders", options);

    expect(driver.channel).toHaveBeenCalledWith("orders", options);
    expect(result).toBe(channelObject);
  });

  it("delegates publish() to the driver", () => {
    const driver = createDriver();
    const broker = new Broker({ name: "a", driver });

    class Evt extends EventMessage<{ id: number }> {
      public eventName = "x";
    }
    const event = new Evt({ id: 1 });

    broker.publish(event);

    expect(driver.publish).toHaveBeenCalledWith(event);
  });

  it("delegates subscribe() to the driver and returns its unsubscribe handle", () => {
    const unsubscribe = vi.fn();
    const driver = createDriver({ subscribe: vi.fn(() => unsubscribe) as never });
    const broker = new Broker({ name: "a", driver });

    const Consumer = class {} as unknown as EventConsumerClass;
    const handle = broker.subscribe(Consumer);

    expect(driver.subscribe).toHaveBeenCalledWith(Consumer);
    expect(handle).toBe(unsubscribe);
  });

  it("reflects the driver's connection state", () => {
    const driver = createDriver({ isConnected: true });
    const broker = new Broker({ name: "a", driver });

    expect(broker.isConnected).toBe(true);
  });

  it("forwards lifecycle calls to the driver", async () => {
    const driver = createDriver();
    const broker = new Broker({ name: "a", driver });

    await broker.connect();
    await broker.disconnect();
    await broker.startConsuming();
    await broker.stopConsuming();
    await broker.healthCheck();

    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(driver.startConsuming).toHaveBeenCalledTimes(1);
    expect(driver.stopConsuming).toHaveBeenCalledTimes(1);
    expect(driver.healthCheck).toHaveBeenCalledTimes(1);
  });

  it("returns the driver's health check result", async () => {
    const driver = createDriver({
      healthCheck: vi.fn(async () => ({ healthy: false, error: "down" })) as never,
    });
    const broker = new Broker({ name: "a", driver });

    await expect(broker.healthCheck()).resolves.toEqual({ healthy: false, error: "down" });
  });
});
