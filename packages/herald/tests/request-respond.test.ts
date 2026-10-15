import { describe, expect, it } from "vitest";
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
