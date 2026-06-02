import { vi } from "vitest";

/**
 * A recorded `sendToQueue` call against the fake AMQP channel.
 */
export type SentMessage = {
  queue: string;
  content: Buffer;
  options: Record<string, unknown>;
};

/**
 * In-memory stand-in for an `amqplib` confirm/regular channel.
 *
 * **Role.** Captures every interaction `RabbitMQChannel` / `RabbitMQDriver`
 * make against the AMQP channel so tests can assert envelope shape, queue
 * routing, ack/nack decisions, and retry/dead-letter behavior without a live
 * broker.
 *
 * **Responsibility.**
 * - Owns: recording `sendToQueue`, `assertQueue`, ack/nack/reject calls, and
 *   replaying a delivered message into a registered consumer callback.
 * - Does NOT own: any AMQP wire semantics — it is a pure spy. Delivery is
 *   manual via `deliver(...)`.
 *
 * @example
 * const amqp = new FakeAmqpChannel();
 * const channel = new RabbitMQChannel("orders", amqp);
 * await channel.publish({ id: 1 });
 * expect(amqp.sent[0].queue).toBe("orders");
 */
export class FakeAmqpChannel {
  public readonly sent: SentMessage[] = [];
  public readonly assertedQueues: Array<{ name: string; options: Record<string, unknown> }> = [];

  public readonly ack = vi.fn();
  public readonly nack = vi.fn();
  public readonly reject = vi.fn();
  public readonly prefetch = vi.fn();
  public readonly cancel = vi.fn();
  public readonly deleteQueue = vi.fn();

  private consumeCallback: ((message: unknown) => unknown) | null = null;
  private consumerCounter = 0;
  private replyQueueCounter = 0;

  public async assertQueue(
    name: string,
    options: Record<string, unknown> = {},
  ): Promise<{ queue: string }> {
    const resolvedName = name === "" ? `amq.gen-${++this.replyQueueCounter}` : name;

    this.assertedQueues.push({ name: resolvedName, options });

    return { queue: resolvedName };
  }

  public sendToQueue(queue: string, content: Buffer, options: Record<string, unknown> = {}): boolean {
    this.sent.push({ queue, content, options });

    return true;
  }

  public async consume(
    _queue: string,
    callback: (message: unknown) => unknown,
    _options: Record<string, unknown> = {},
  ): Promise<{ consumerTag: string }> {
    this.consumeCallback = callback;

    return { consumerTag: `consumer-${++this.consumerCounter}` };
  }

  public async checkQueue(name: string): Promise<{
    queue: string;
    messageCount: number;
    consumerCount: number;
  }> {
    return { queue: name, messageCount: 0, consumerCount: 0 };
  }

  public async purgeQueue(_name: string): Promise<{ messageCount: number }> {
    return { messageCount: 0 };
  }

  /**
   * Build a raw AMQP delivery object the way amqplib would hand it to a consumer
   * callback, from a herald-wrapped envelope payload.
   */
  public buildDelivery(
    payload: unknown,
    properties: Record<string, unknown> = {},
    envelopeMetadata: Record<string, unknown> = {},
  ): { content: Buffer; properties: Record<string, unknown> } {
    const body = JSON.stringify({
      payload,
      metadata: {
        messageId: "envelope-message-id",
        timestamp: new Date().toISOString(),
        ...envelopeMetadata,
      },
    });

    return {
      content: Buffer.from(body),
      properties: {
        messageId: "amqp-message-id",
        timestamp: Date.now(),
        ...properties,
      },
    };
  }

  /**
   * Replay a delivery through the registered consumer callback. Resolves once
   * the callback's returned promise settles so tests can assert on async flow.
   */
  public async deliver(message: unknown): Promise<void> {
    if (!this.consumeCallback) {
      throw new Error("No consumer registered on the fake AMQP channel.");
    }

    await this.consumeCallback(message);
  }

  /**
   * Parse a recorded `sendToQueue` body back into its `{ payload, metadata }`
   * shape for assertions.
   */
  public decode(index = 0): { payload: unknown; metadata: Record<string, unknown> } {
    const entry = this.sent[index];

    if (!entry) {
      throw new Error(`No message recorded at index ${index}.`);
    }

    return JSON.parse(entry.content.toString());
  }
}
