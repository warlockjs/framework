import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brokerRegistry } from "../src/communicators";
import type { BrokerDriverContract } from "../src/contracts";
import { Consumable, pendingSubscribers } from "../src/decorators/consumable";
import { EventConsumer } from "../src/message-managers/event-consumer";
import type { EventConsumerClass } from "../src/message-managers/types";

type FakeDriver = BrokerDriverContract & {
  emitter: EventEmitter;
  connectedState: boolean;
};

/**
 * Driver stand-in for decorator tests. `isConnected` is backed by a mutable
 * `connectedState` flag, and `subscribe` is a spy so a test can assert whether
 * the decorator wired the consumer immediately. The `emitter` lets a test fire
 * the driver's lifecycle events that the registry forwards.
 */
function createFakeDriver(connected = false): FakeDriver {
  const emitter = new EventEmitter();

  const driver = {
    name: "rabbitmq",
    connectedState: connected,
    emitter,
    get isConnected() {
      return this.connectedState;
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => emitter.off(event, listener),
    subscribe: vi.fn(() => () => undefined),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    channel: vi.fn(),
    startConsuming: vi.fn(),
    stopConsuming: vi.fn(),
    healthCheck: vi.fn(),
    getChannelNames: vi.fn(() => []),
    closeChannel: vi.fn(),
  };

  return driver as unknown as FakeDriver;
}

class DemoConsumer extends EventConsumer {
  public static eventName = "demo.consumable";
  public async handle() {}
}

describe("Consumable decorator", () => {
  beforeEach(() => {
    pendingSubscribers.clear();
    brokerRegistry.clear();
  });

  afterEach(() => {
    pendingSubscribers.clear();
    brokerRegistry.clear();
  });

  it("subscribes immediately when the target broker is already connected", () => {
    const driver = createFakeDriver(true);
    const broker = brokerRegistry.register({ name: "default", driver });

    Consumable()(DemoConsumer as unknown as EventConsumerClass);

    expect(broker.driver.subscribe).toHaveBeenCalledWith(DemoConsumer);
    expect(pendingSubscribers.size).toBe(0);
  });

  it("buffers the consumer when the broker exists but is not connected", () => {
    const driver = createFakeDriver(false);
    brokerRegistry.register({ name: "default", driver });

    Consumable()(DemoConsumer as unknown as EventConsumerClass);

    expect(driver.subscribe).not.toHaveBeenCalled();
    expect(pendingSubscribers.size).toBe(1);
  });

  it("buffers the consumer when no broker is registered at all", () => {
    Consumable()(DemoConsumer as unknown as EventConsumerClass);

    expect(pendingSubscribers.size).toBe(1);
    const entry = Array.from(pendingSubscribers)[0];
    expect(entry.Consumer).toBe(DemoConsumer);
  });

  it("targets a named broker via the broker option", () => {
    const namedDriver = createFakeDriver(true);
    brokerRegistry.register({ name: "default", driver: createFakeDriver(true) });
    const named = brokerRegistry.register({ name: "analytics", driver: namedDriver });

    Consumable({ broker: "analytics" })(DemoConsumer as unknown as EventConsumerClass);

    expect(named.driver.subscribe).toHaveBeenCalledWith(DemoConsumer);
  });

  it("drains pending subscribers onto the broker when it connects", () => {
    const driver = createFakeDriver(false);
    const broker = brokerRegistry.register({ name: "default", driver });

    // Buffered while disconnected.
    Consumable()(DemoConsumer as unknown as EventConsumerClass);
    expect(driver.subscribe).not.toHaveBeenCalled();

    // The registry forwards the driver's "connected" event, which the
    // consumable module listens for to drain the pending set.
    driver.emitter.emit("connected");

    expect(broker.driver.subscribe).toHaveBeenCalledWith(DemoConsumer);
  });

  it("does not drain a pending consumer onto a broker whose name does not match its broker option", () => {
    const analyticsDriver = createFakeDriver(false);
    brokerRegistry.register({ name: "analytics", driver: analyticsDriver });

    // Consumer is pinned to a different broker name.
    Consumable({ broker: "notifications" })(DemoConsumer as unknown as EventConsumerClass);

    analyticsDriver.emitter.emit("connected");

    expect(analyticsDriver.subscribe).not.toHaveBeenCalled();
  });
});
