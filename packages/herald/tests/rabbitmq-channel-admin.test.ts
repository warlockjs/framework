import { beforeEach, describe, expect, it, vi } from "vitest";
import { RabbitMQChannel } from "../src/drivers/rabbitmq/rabbitmq-channel";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

type OrderPayload = { orderId: number };

/**
 * Spin the microtask queue so a not-yet-awaited async operation records its
 * side effects before the test inspects them.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("RabbitMQChannel — assert options", () => {
  it("maps dead-letter options onto the asserted queue arguments", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<OrderPayload>("orders", amqp, {
      durable: false,
      autoDelete: true,
      exclusive: true,
      messageTtl: 60_000,
      maxLength: 100,
      deadLetter: { channel: "orders.dlq" },
    });

    await channel.assert();

    const asserted = amqp.assertedQueues.find((entry) => entry.name === "orders");

    expect(asserted).toBeDefined();
    expect(asserted!.options).toMatchObject({
      durable: false,
      autoDelete: true,
      exclusive: true,
      messageTtl: 60_000,
      maxLength: 100,
      deadLetterExchange: "",
      deadLetterRoutingKey: "orders.dlq",
    });
  });

  it("leaves dead-letter routing undefined when no dead-letter channel is set", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<OrderPayload>("orders", amqp);

    await channel.assert();

    const asserted = amqp.assertedQueues.find((entry) => entry.name === "orders");

    expect(asserted!.options).toMatchObject({
      durable: true,
      deadLetterExchange: undefined,
      deadLetterRoutingKey: undefined,
    });
  });

  it("asserts at most once even across explicit + implicit calls", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<OrderPayload>("orders", amqp);

    await channel.assert();
    await channel.publish({ orderId: 1 });
    await channel.assert();

    const orderAsserts = amqp.assertedQueues.filter((entry) => entry.name === "orders");

    expect(orderAsserts).toHaveLength(1);
  });
});

describe("RabbitMQChannel — admin operations", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("stats returns the queue's message and consumer counts", async () => {
    vi.spyOn(amqp, "checkQueue").mockResolvedValueOnce({
      queue: "orders",
      messageCount: 12,
      consumerCount: 3,
    });

    const stats = await channel.stats();

    expect(stats).toEqual({ name: "orders", messageCount: 12, consumerCount: 3 });
  });

  it("purge returns the number of removed messages", async () => {
    vi.spyOn(amqp, "purgeQueue").mockResolvedValueOnce({ messageCount: 7 });

    const purged = await channel.purge();

    expect(purged).toBe(7);
  });

  it("exists resolves true when checkQueue succeeds", async () => {
    await expect(channel.exists()).resolves.toBe(true);
  });

  it("exists resolves false when checkQueue throws", async () => {
    vi.spyOn(amqp, "checkQueue").mockRejectedValueOnce(new Error("NOT_FOUND"));

    await expect(channel.exists()).resolves.toBe(false);
  });

  it("delete removes the queue and resets the asserted flag so a later op re-asserts", async () => {
    await channel.assert();
    expect(amqp.assertedQueues.filter((entry) => entry.name === "orders")).toHaveLength(1);

    await channel.delete();

    expect(amqp.deleteQueue).toHaveBeenCalledWith("orders");

    // After delete, the channel is no longer asserted, so the next publish re-asserts.
    await channel.publish({ orderId: 1 });

    expect(amqp.assertedQueues.filter((entry) => entry.name === "orders")).toHaveLength(2);
  });

  it("delete swallows a deleteQueue failure", async () => {
    amqp.deleteQueue.mockRejectedValueOnce(new Error("queue busy"));

    await expect(channel.delete()).resolves.toBeUndefined();
  });

  it("delete cancels active subscriptions before removing the queue", async () => {
    await channel.subscribe(async () => undefined);

    await channel.delete();

    expect(amqp.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("RabbitMQChannel — subscription lifecycle", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("subscribe returns a subscription with a stable id and the consumer tag", async () => {
    const subscription = await channel.subscribe(async () => undefined, {
      consumerId: "fixed-consumer",
    });

    expect(subscription.id).toBe("fixed-consumer");
    expect(subscription.consumerTag).toBe("consumer-1");
    expect(subscription.channel).toBe("orders");
    expect(subscription.isActive()).toBe(true);
  });

  it("unsubscribeById cancels the consumer and removes it from the registry", async () => {
    await channel.subscribe(async () => undefined, { consumerId: "c-1" });

    await channel.unsubscribeById("c-1");

    expect(amqp.cancel).toHaveBeenCalledWith("consumer-1");

    // A second call is a no-op because the subscription was removed.
    amqp.cancel.mockClear();
    await channel.unsubscribeById("c-1");
    expect(amqp.cancel).not.toHaveBeenCalled();
  });

  it("unsubscribeById is a no-op for an unknown consumer id", async () => {
    await channel.unsubscribeById("ghost");

    expect(amqp.cancel).not.toHaveBeenCalled();
  });

  it("stopConsuming cancels every active subscription", async () => {
    await channel.subscribe(async () => undefined, { consumerId: "a" });
    await channel.subscribe(async () => undefined, { consumerId: "b" });

    await channel.stopConsuming();

    expect(amqp.cancel).toHaveBeenCalledTimes(2);
  });

  it("a subscription's unsubscribe is idempotent — cancel fires only once", async () => {
    const subscription = await channel.subscribe(async () => undefined);

    await subscription.unsubscribe();
    await subscription.unsubscribe();

    expect(amqp.cancel).toHaveBeenCalledTimes(1);
    expect(subscription.isActive()).toBe(false);
  });

  it("subscription.resume throws because RabbitMQ cannot resume a cancelled consumer", async () => {
    const subscription = await channel.subscribe(async () => undefined);

    await expect(subscription.resume()).rejects.toThrow(/Resume is not supported for RabbitMQ/);
  });
});

describe("RabbitMQChannel — subscribe options", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("applies the prefetch count before consuming", async () => {
    await channel.subscribe(async () => undefined, { prefetch: 25 });

    expect(amqp.prefetch).toHaveBeenCalledWith(25);
  });

  it("uses the consumer group as the consumer tag when provided", async () => {
    const consumeSpy = vi.spyOn(amqp, "consume");

    await channel.subscribe(async () => undefined, { group: "workers" });

    const consumeOptions = consumeSpy.mock.calls[0][2] as Record<string, unknown>;

    expect(consumeOptions.consumerTag).toBe("workers");
  });

  it("sets noAck when autoAck is true and never acks from the framework", async () => {
    const consumeSpy = vi.spyOn(amqp, "consume");

    await channel.subscribe(async () => undefined, { autoAck: true });

    const consumeOptions = consumeSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(consumeOptions.noAck).toBe(true);

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    // Fire-and-forget: the broker already acked, so the framework must not ack again.
    expect(amqp.ack).not.toHaveBeenCalled();
  });

  it("ignores a null delivery without touching ack/nack", async () => {
    await channel.subscribe(async () => undefined);

    await amqp.deliver(null);

    expect(amqp.ack).not.toHaveBeenCalled();
    expect(amqp.nack).not.toHaveBeenCalled();
  });
});

describe("RabbitMQChannel — explicit flow control", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("ctx.reject rejects without requeue and suppresses the auto-ack", async () => {
    await channel.subscribe(async (_message, ctx) => {
      await ctx.reject();
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.reject).toHaveBeenCalledWith(expect.anything(), false);
    expect(amqp.ack).not.toHaveBeenCalled();
  });

  it("ctx.ack is honoured only once even when called repeatedly", async () => {
    await channel.subscribe(async (_message, ctx) => {
      await ctx.ack();
      await ctx.ack();
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.ack).toHaveBeenCalledTimes(1);
  });

  it("explicit ctx.ack wins over the smart auto-nack when the handler later throws", async () => {
    await channel.subscribe(async (_message, ctx) => {
      await ctx.ack();
      throw new Error("after ack");
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.ack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).not.toHaveBeenCalled();
    expect(amqp.reject).not.toHaveBeenCalled();
  });

  it("ctx.retry attaches an x-delay header on the republished message when a delay is given", async () => {
    await channel.subscribe(
      async (_message, ctx) => {
        await ctx.retry(2_500);
      },
      { retry: { maxRetries: 5, delay: 0 } },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 0 } }));

    const republish = amqp.sent.find((entry) => entry.queue === "orders");

    expect(republish).toBeDefined();
    const headers = republish!.options.headers as Record<string, unknown>;
    expect(headers["x-retry-count"]).toBe(1);
    expect(headers["x-delay"]).toBe(2_500);
  });

  it("ctx.retry is a no-op once acknowledgement was already handled", async () => {
    await channel.subscribe(
      async (_message, ctx) => {
        await ctx.ack();
        await ctx.retry();
      },
      { retry: { maxRetries: 3, delay: 0 } },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    // Only the explicit ack happened; retry must not republish.
    expect(amqp.sent.some((entry) => entry.queue === "orders")).toBe(false);
    expect(amqp.ack).toHaveBeenCalledTimes(1);
  });
});

describe("RabbitMQChannel — throw-path retry routing", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("dead-letters and acks at the retry ceiling when a dead-letter is configured", async () => {
    await channel.subscribe(
      async () => {
        throw new Error("boom");
      },
      {
        retry: { maxRetries: 2, delay: 0 },
        deadLetter: { channel: "orders.dlq" },
      },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 2 } }));

    // At the ceiling with a DLQ configured the consume-side path routes to the
    // dead-letter queue and acks the original — never a bare nack, which
    // would just requeue the same message with a stuck counter.
    const deadLettered = amqp.sent.find((entry) => entry.queue === "orders.dlq");
    expect(deadLettered).toBeDefined();
    expect(JSON.parse(deadLettered!.content.toString()).payload).toEqual({ orderId: 1 });
    expect(amqp.ack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).not.toHaveBeenCalled();
  });

  it("rejects at the retry ceiling when no dead-letter is configured", async () => {
    await channel.subscribe(
      async () => {
        throw new Error("boom");
      },
      { retry: { maxRetries: 2, delay: 0 } },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 2 } }));

    expect(amqp.reject).toHaveBeenCalledWith(expect.anything(), false);
    expect(amqp.nack).not.toHaveBeenCalled();
  });
});

describe("RabbitMQChannel — respond auto-acks", () => {
  it("acks the request message after replying", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<{ amount: number }>("compute.tax", amqp);

    await channel.respond<{ tax: number }>(async (message) => ({
      tax: message.payload.amount * 0.2,
    }));

    await amqp.deliver(
      amqp.buildDelivery({ amount: 500 }, { replyTo: "reply-q", correlationId: "c-1" }),
    );

    await flush();

    expect(amqp.ack).toHaveBeenCalledTimes(1);
    const reply = amqp.sent.find((entry) => entry.queue === "reply-q");
    expect(JSON.parse(reply!.content.toString()).payload).toEqual({ tax: 100 });
  });
});
