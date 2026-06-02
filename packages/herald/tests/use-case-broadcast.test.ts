import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRegistry } from "../src/communicators";
import type { BrokerDriverContract } from "../src/contracts";
import { heraldBroadcast, type UseCaseBroadcastEvent } from "../src/use-case-broadcast";

/**
 * Driver whose `channel()` hands back a stub exposing a `publish` spy, so the
 * broadcast adapter's routing (channel name + published body) can be asserted.
 */
function createDriverWithChannelSpy() {
  const publish = vi.fn(async () => undefined);
  const channel = vi.fn(() => ({ publish }));

  const driver = {
    name: "rabbitmq",
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    channel,
    startConsuming: vi.fn(),
    stopConsuming: vi.fn(),
    healthCheck: vi.fn(),
    getChannelNames: vi.fn(() => []),
    closeChannel: vi.fn(),
  } as unknown as BrokerDriverContract;

  return { driver, channel, publish };
}

function makeEvent(overrides: Partial<UseCaseBroadcastEvent> = {}): UseCaseBroadcastEvent {
  return {
    useCase: "CreateOrder",
    event: "order.created",
    id: "evt-1",
    at: new Date(),
    payload: { orderId: 1 },
    ...overrides,
  };
}

describe("heraldBroadcast", () => {
  afterEach(() => {
    brokerRegistry.clear();
  });

  it("publishes the event payload to a channel named after the event on the default broker", async () => {
    const { driver, channel, publish } = createDriverWithChannelSpy();
    brokerRegistry.register({ name: "default", driver });

    const adapter = heraldBroadcast();

    await adapter.broadcast(makeEvent({ event: "order.created", payload: { orderId: 42 } }));

    // Broker.channel forwards (name, options) to the driver; the adapter passes
    // no options, so only assert the routing-key argument.
    expect(channel.mock.calls[0][0]).toBe("order.created");
    expect(publish).toHaveBeenCalledWith({ orderId: 42 });
  });

  it("routes to the named broker when a broker option is supplied", async () => {
    const fallback = createDriverWithChannelSpy();
    const analytics = createDriverWithChannelSpy();

    brokerRegistry.register({ name: "default", driver: fallback.driver });
    brokerRegistry.register({ name: "analytics", driver: analytics.driver });

    const adapter = heraldBroadcast({ broker: "analytics" });

    await adapter.broadcast(makeEvent({ event: "page.viewed", payload: { path: "/" } }));

    expect(analytics.channel.mock.calls[0][0]).toBe("page.viewed");
    expect(analytics.publish).toHaveBeenCalledWith({ path: "/" });
    expect(fallback.channel).not.toHaveBeenCalled();
  });
});
