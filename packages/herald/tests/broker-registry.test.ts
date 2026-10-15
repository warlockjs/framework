import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRegistry, MissingBrokerError } from "../src/communicators/broker-registry";
import type { BrokerDriverContract } from "../src/contracts";

type FakeDriver = BrokerDriverContract & { emitter: EventEmitter };

/**
 * Minimal driver stand-in for registry tests. Only the surface the registry
 * touches (`on`, `isConnected`) needs to behave; the rest are no-op spies. The
 * underlying `emitter` is exposed so tests can fire lifecycle events.
 */
function createFakeDriver(): FakeDriver {
  const emitter = new EventEmitter();

  const driver = {
    name: "rabbitmq",
    isConnected: false,
    emitter,
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

describe("BrokerRegistry", () => {
  afterEach(() => {
    brokerRegistry.clear();
  });

  it("resolves the default broker when no name is passed", () => {
    const broker = brokerRegistry.register({ name: "primary", driver: createFakeDriver() });

    expect(brokerRegistry.get()).toBe(broker);
    expect(brokerRegistry.getDefault()).toBe(broker);
  });

  it("treats the first registered broker as default even without isDefault", () => {
    const first = brokerRegistry.register({ name: "first", driver: createFakeDriver() });

    brokerRegistry.register({ name: "second", driver: createFakeDriver() });

    expect(brokerRegistry.getDefault()).toBe(first);
  });

  it("promotes a later broker to default when isDefault is set", () => {
    brokerRegistry.register({ name: "first", driver: createFakeDriver() });
    const second = brokerRegistry.register({
      name: "second",
      driver: createFakeDriver(),
      isDefault: true,
    });

    expect(brokerRegistry.getDefault()).toBe(second);
    expect(brokerRegistry.get()).toBe(second);
  });

  it("resolves a named broker", () => {
    brokerRegistry.register({ name: "primary", driver: createFakeDriver() });
    const analytics = brokerRegistry.register({ name: "analytics", driver: createFakeDriver() });

    expect(brokerRegistry.get("analytics")).toBe(analytics);
  });

  it("throws MissingBrokerError for an unregistered name", () => {
    brokerRegistry.register({ name: "primary", driver: createFakeDriver() });

    expect(() => brokerRegistry.get("ghost")).toThrowError(MissingBrokerError);
  });

  it("throws MissingBrokerError when no default exists", () => {
    expect(() => brokerRegistry.get()).toThrowError("No default broker registered.");
  });

  it("reports membership via has / hasAny", () => {
    expect(brokerRegistry.hasAny()).toBe(false);

    brokerRegistry.register({ name: "primary", driver: createFakeDriver() });

    expect(brokerRegistry.has("primary")).toBe(true);
    expect(brokerRegistry.has("missing")).toBe(false);
    expect(brokerRegistry.hasAny()).toBe(true);
  });

  it("lists all brokers and names", () => {
    brokerRegistry.register({ name: "a", driver: createFakeDriver() });
    brokerRegistry.register({ name: "b", driver: createFakeDriver() });

    expect(brokerRegistry.getNames()).toEqual(["a", "b"]);
    expect(brokerRegistry.getAll()).toHaveLength(2);
  });

  it("emits registered and default-registered on registration", () => {
    const registered = vi.fn();
    const defaultRegistered = vi.fn();

    brokerRegistry.on("registered", registered);
    brokerRegistry.on("default-registered", defaultRegistered);

    const broker = brokerRegistry.register({ name: "primary", driver: createFakeDriver() });

    expect(registered).toHaveBeenCalledWith(broker);
    expect(defaultRegistered).toHaveBeenCalledWith(broker);
  });

  it("forwards driver connected / disconnected events to the registry", () => {
    const driver = createFakeDriver();
    const connected = vi.fn();
    const disconnected = vi.fn();

    brokerRegistry.on("connected", connected);
    brokerRegistry.on("disconnected", disconnected);

    const broker = brokerRegistry.register({ name: "primary", driver });

    driver.emitter.emit("connected");
    driver.emitter.emit("disconnected");

    expect(connected).toHaveBeenCalledWith(broker);
    expect(disconnected).toHaveBeenCalledWith(broker);
  });

  it("clears every broker", () => {
    brokerRegistry.register({ name: "primary", driver: createFakeDriver() });

    brokerRegistry.clear();

    expect(brokerRegistry.hasAny()).toBe(false);
    expect(brokerRegistry.getDefault()).toBeUndefined();
  });
});
