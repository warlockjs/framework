import { describe, expect, it, vi } from "vitest";
import { RabbitMQChannel } from "../src/drivers/rabbitmq/rabbitmq-channel";
import { FakeAmqpChannel } from "./helpers/fake-amqp";

type TaxRequest = { amount: number };
type TaxReply = { tax: number };

/**
 * Spin the microtask queue so a not-yet-awaited async operation records its
 * side effects (the `request` publish) before the test inspects them.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("RabbitMQChannel — request/respond correlation", () => {
  it("resolves with the reply whose correlationId matches the request", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    const pending = channel.request<TaxReply>({ amount: 1000 }, { timeout: 5_000 });

    await flush();

    const requestSend = amqp.sent.find((entry) => entry.queue === "compute.tax");

    expect(requestSend).toBeDefined();

    const correlationId = requestSend!.options.correlationId as string;
    const replyTo = requestSend!.options.replyTo as string;

    expect(typeof correlationId).toBe("string");
    expect(typeof replyTo).toBe("string");

    // The request also sets an expiration equal to the timeout.
    expect(requestSend!.options.expiration).toBe("5000");

    // Deliver a correlated reply back through the reply-queue consumer.
    await amqp.deliver({
      content: Buffer.from(JSON.stringify({ payload: { tax: 100 } })),
      properties: { correlationId },
    });

    await expect(pending).resolves.toEqual({ tax: 100 });
  });

  it("ignores replies whose correlationId does not match, then times out", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    const pending = channel.request<TaxReply>({ amount: 1000 }, { timeout: 60 });

    await flush();

    // A reply for a different request — must be ignored.
    await amqp.deliver({
      content: Buffer.from(JSON.stringify({ payload: { tax: 999 } })),
      properties: { correlationId: "some-other-correlation" },
    });

    await expect(pending).rejects.toThrow(/Request timeout after 60ms/);
  });

  it("rejects with a timeout error when no reply arrives", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    await expect(channel.request({ amount: 1 }, { timeout: 50 })).rejects.toThrow(
      /Request timeout after 50ms/,
    );
  });

  it("shares one direct reply-to consumer across requests and creates no queue per call", async () => {
    const amqp = new FakeAmqpChannel();
    const consume = vi.spyOn(amqp, "consume");
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);
    const other = new RabbitMQChannel<TaxRequest>("compute.vat", amqp);

    const pending = Array.from({ length: 10 }, (_, index) =>
      (index % 2 === 0 ? channel : other).request<TaxReply>({ amount: index }, { timeout: 5_000 }),
    );

    await flush();

    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]?.[0]).toBe("amq.rabbitmq.reply-to");
    expect(amqp.assertedQueues.filter((entry) => entry.name.startsWith("amq.gen"))).toEqual([]);

    const requests = amqp.sent.filter((entry) => entry.queue.startsWith("compute."));
    expect(requests).toHaveLength(10);

    for (const [index, request] of requests.entries()) {
      expect(request.options.replyTo).toBe("amq.rabbitmq.reply-to");
      await amqp.deliver({
        content: Buffer.from(JSON.stringify({ payload: { tax: index } })),
        properties: { correlationId: request.options.correlationId },
      });
    }

    const replies = await Promise.all(pending);
    expect(replies.map((reply) => reply.tax).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);

    // A second reply for an answered request finds nothing waiting and is dropped.
    await expect(
      amqp.deliver({
        content: Buffer.from(JSON.stringify({ payload: { tax: 1 } })),
        properties: { correlationId: requests[0]!.options.correlationId },
      }),
    ).resolves.toBeUndefined();
  });

  it("publishes only AMQP properties and keeps its own correlation id", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    const pending = channel.request<TaxReply>(
      { amount: 1 },
      { timeout: 50, correlationId: "caller-id", priority: 3 },
    );

    await flush();

    const options = amqp.sent[0]!.options;
    expect(options).not.toHaveProperty("timeout");
    expect(options.correlationId).not.toBe("caller-id");
    expect(options.priority).toBe(3);

    await expect(pending).rejects.toThrow(/Request timeout after 50ms/);
  });

  it("rejects when the reply is not valid JSON instead of throwing in the consumer", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    const pending = channel.request<TaxReply>({ amount: 1 }, { timeout: 5_000 });
    await flush();

    await amqp.deliver({
      content: Buffer.from("{not json"),
      properties: { correlationId: amqp.sent[0]!.options.correlationId },
    });

    await expect(pending).rejects.toThrow(/not valid JSON/);
  });

  it("respond replies with the handler's return value", async () => {
    const amqp = new FakeAmqpChannel();
    const channel = new RabbitMQChannel<TaxRequest>("compute.tax", amqp);

    await channel.respond<TaxReply>(async (message) => {
      return { tax: message.payload.amount * 0.1 };
    });

    await amqp.deliver(
      amqp.buildDelivery({ amount: 2000 }, { replyTo: "reply-q", correlationId: "corr-r" }),
    );

    const reply = amqp.sent.find((entry) => entry.queue === "reply-q");

    expect(reply).toBeDefined();
    expect(JSON.parse(reply!.content.toString()).payload).toEqual({ tax: 200 });
    expect(reply!.options.correlationId).toBe("corr-r");
  });
});
