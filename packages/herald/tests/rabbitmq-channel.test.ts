import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RabbitMQChannel } from "../src/drivers/rabbitmq/rabbitmq-channel";
import type { MessageContext } from "../src/types";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

type OrderPayload = { orderId: number };

describe("RabbitMQChannel — publish", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("lazily asserts the queue on first publish, only once", async () => {
    await channel.publish({ orderId: 1 });
    await channel.publish({ orderId: 2 });

    const orderAsserts = amqp.assertedQueues.filter((entry) => entry.name === "orders");

    expect(orderAsserts).toHaveLength(1);
    expect(orderAsserts[0].options).toMatchObject({ durable: true, autoDelete: false });
  });

  it("routes to the queue named after the channel", async () => {
    await channel.publish({ orderId: 1 });

    expect(amqp.sent[0].queue).toBe("orders");
  });

  it("wraps the payload in a metadata envelope", async () => {
    await channel.publish({ orderId: 7 });

    const envelope = amqp.decode();

    expect(envelope.payload).toEqual({ orderId: 7 });
    expect(typeof envelope.metadata.messageId).toBe("string");
    expect(typeof envelope.metadata.timestamp).toBe("string");
  });

  it("maps publish options onto AMQP message properties", async () => {
    await channel.publish(
      { orderId: 1 },
      {
        priority: 5,
        persistent: true,
        correlationId: "corr-1",
        expiration: 60_000,
        headers: { tenantId: "42" },
      },
    );

    const options = amqp.sent[0].options;

    expect(options.priority).toBe(5);
    expect(options.persistent).toBe(true);
    expect(options.correlationId).toBe("corr-1");
    expect(options.expiration).toBe("60000");
    expect(options.headers).toMatchObject({ tenantId: "42" });
  });

  it("defaults persistent to true", async () => {
    await channel.publish({ orderId: 1 });

    expect(amqp.sent[0].options.persistent).toBe(true);
  });

  it("adds an x-delay header for delayed delivery", async () => {
    await channel.publish({ orderId: 1 }, { delay: 5_000 });

    expect((amqp.sent[0].options.headers as Record<string, unknown>)["x-delay"]).toBe(5_000);
  });

  it("publishBatch sends one message per payload", async () => {
    await channel.publishBatch([{ orderId: 1 }, { orderId: 2 }, { orderId: 3 }]);

    expect(amqp.sent).toHaveLength(3);
    expect(amqp.decode(0).payload).toEqual({ orderId: 1 });
    expect(amqp.decode(2).payload).toEqual({ orderId: 3 });
  });
});

describe("RabbitMQChannel — schema validation", () => {
  it("throws on publish when the payload fails the channel schema", async () => {
    const amqp = new FakeAmqpChannel();
    const schema = v.object({ orderId: v.int() });
    const channel = new RabbitMQChannel("orders", amqp, { schema });

    await expect(channel.publish({ orderId: "nope" } as never)).rejects.toThrow(
      /Message validation failed/,
    );
    expect(amqp.sent).toHaveLength(0);
  });

  it("publishes coerced data when the schema passes", async () => {
    const amqp = new FakeAmqpChannel();
    const schema = v.object({ orderId: v.int() });
    const channel = new RabbitMQChannel("orders", amqp, { schema });

    await channel.publish({ orderId: 5 });

    expect(amqp.decode().payload).toMatchObject({ orderId: 5 });
  });
});

describe("RabbitMQChannel — subscribe smart ack", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("auto-acks when the handler resolves without touching ctx", async () => {
    await channel.subscribe(async () => undefined);

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.ack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).not.toHaveBeenCalled();
  });

  it("respects an explicit ctx.nack and does not auto-ack", async () => {
    await channel.subscribe(async (_message, ctx) => {
      await ctx.nack(false);
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.nack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(amqp.ack).not.toHaveBeenCalled();
  });

  it("exposes typed payload and metadata to the handler", async () => {
    let seen: { orderId: number } | undefined;
    let correlationId: string | undefined;

    await channel.subscribe(async (message) => {
      seen = message.payload;
      correlationId = message.metadata.correlationId;
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 9 }, { correlationId: "trace-9" }));

    expect(seen).toEqual({ orderId: 9 });
    expect(correlationId).toBe("trace-9");
  });

  it("auto-nacks without requeue when the handler throws and no retry is configured", async () => {
    await channel.subscribe(async () => {
      throw new Error("boom");
    });

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }));

    expect(amqp.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it("republishes with an incremented x-retry-count when the handler throws under maxRetries", async () => {
    // Regression guard: a bare `nack(msg, false, true)` here would redeliver
    // the ORIGINAL message untouched, so the counter would never advance and
    // maxRetries/deadLetter would never be reached — the automatic path must
    // republish with the incremented header, same as ctx.retry() does.
    await channel.subscribe(
      async () => {
        throw new Error("boom");
      },
      { retry: { maxRetries: 3, delay: 1000 } },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 1 } }));

    const republish = amqp.sent.find((entry) => entry.queue === "orders");

    expect(republish).toBeDefined();
    expect((republish!.options.headers as Record<string, unknown>)["x-retry-count"]).toBe(2);
    expect(amqp.ack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).not.toHaveBeenCalled();
  });

  it("stops requeuing and dead-letters at maxRetries instead of looping forever", async () => {
    await channel.subscribe(
      async () => {
        throw new Error("boom");
      },
      {
        retry: { maxRetries: 3, delay: 1000 },
        deadLetter: { channel: "orders.failed" },
      },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 3 } }));

    const deadLettered = amqp.sent.find((entry) => entry.queue === "orders.failed");
    expect(deadLettered).toBeDefined();
    expect(JSON.parse(deadLettered!.content.toString()).payload).toEqual({ orderId: 1 });
    expect(amqp.ack).toHaveBeenCalledTimes(1);
    expect(amqp.nack).not.toHaveBeenCalled();
  });

  it("never redelivers the same message past maxRetries even across repeated poison-message deliveries", async () => {
    // Simulates the poison-message DoS: the same failing message redelivered
    // over and over must stop being requeued once the cap is hit, instead of
    // spinning forever.
    await channel.subscribe(
      async () => {
        throw new Error("boom");
      },
      { retry: { maxRetries: 2, delay: 0 } },
    );

    let retryCount = 0;
    for (let i = 0; i < 5; i++) {
      await amqp.deliver(
        amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": retryCount } }),
      );

      const republish = amqp.sent.pop();
      if (republish) {
        retryCount = (republish.options.headers as Record<string, unknown>)[
          "x-retry-count"
        ] as number;
      }
    }

    // Exactly maxRetries republishes happened (x-retry-count 1, 2) — the 3rd
    // and later deliveries were rejected, not requeued again.
    expect(retryCount).toBe(2);
    expect(amqp.reject).toHaveBeenCalled();
  });

  it("rejects invalid messages on the consume side without running the handler", async () => {
    const handler = vi.fn();
    const schema = v.object({ orderId: v.int() });
    const validatingChannel = new RabbitMQChannel("orders", amqp, { schema });

    await validatingChannel.subscribe(handler);

    await amqp.deliver(amqp.buildDelivery({ orderId: "bad" }));

    expect(handler).not.toHaveBeenCalled();
    expect(amqp.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });
});

describe("RabbitMQChannel — ctx.retry and dead-letter", () => {
  let amqp: FakeAmqpChannel;
  let channel: RabbitMQChannel<OrderPayload>;

  beforeEach(() => {
    amqp = new FakeAmqpChannel();
    channel = new RabbitMQChannel<OrderPayload>("orders", amqp);
  });

  it("republishes with an incremented x-retry-count when ctx.retry is called under the ceiling", async () => {
    await channel.subscribe(
      async (_message, ctx) => {
        await ctx.retry();
      },
      { retry: { maxRetries: 3, delay: 0 } },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 1 } }));

    const republish = amqp.sent.find((entry) => entry.queue === "orders");

    expect(republish).toBeDefined();
    expect((republish!.options.headers as Record<string, unknown>)["x-retry-count"]).toBe(2);
    expect(amqp.ack).toHaveBeenCalledTimes(1);
  });

  it("sends to the dead-letter queue and acks when ctx.retry exceeds maxRetries", async () => {
    await channel.subscribe(
      async (_message, ctx) => {
        await ctx.retry();
      },
      {
        retry: { maxRetries: 2, delay: 0 },
        deadLetter: { channel: "orders.failed" },
      },
    );

    await amqp.deliver(amqp.buildDelivery({ orderId: 1 }, { headers: { "x-retry-count": 2 } }));

    const deadLettered = amqp.sent.find((entry) => entry.queue === "orders.failed");

    expect(deadLettered).toBeDefined();
    expect(JSON.parse(deadLettered!.content.toString()).payload).toEqual({ orderId: 1 });
    expect(amqp.ack).toHaveBeenCalledTimes(1);
  });
});

describe("RabbitMQChannel — reply", () => {
  it("ctx.reply sends to replyTo with the same correlationId", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel("compute.tax", amqp);

    await channel.subscribe(async (_message, ctx: MessageContext) => {
      await ctx.reply({ tax: 100 });
    });

    await amqp.deliver(
      amqp.buildDelivery({ amount: 1000 }, { replyTo: "reply-queue-1", correlationId: "corr-x" }),
    );

    const reply = amqp.sent.find((entry) => entry.queue === "reply-queue-1");

    expect(reply).toBeDefined();
    expect(reply!.options.correlationId).toBe("corr-x");
    expect(JSON.parse(reply!.content.toString()).payload).toEqual({ tax: 100 });
  });

  it("ctx.reply is a no-op when no replyTo is present", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel("compute.tax", amqp);

    await channel.subscribe(async (_message, ctx: MessageContext) => {
      await ctx.reply({ tax: 100 });
      await ctx.ack();
    });

    await amqp.deliver(amqp.buildDelivery({ amount: 1000 }));

    expect(amqp.sent.some((entry) => entry.queue.startsWith("reply"))).toBe(false);
  });
});
