import { log } from "@warlock.js/logger";
import { v } from "@warlock.js/seal";
import { randomUUID } from "node:crypto";
import type { ChannelContract } from "../../contracts";
import type {
  ChannelOptions,
  ChannelStats,
  Message,
  MessageContext,
  MessageHandler,
  MessageMetadata,
  PublishOptions,
  RequestOptions,
  ResponseHandler,
  SubscribeOptions,
  Subscription,
} from "../../types";

/**
 * RabbitMQ Channel Implementation
 *
 * Wraps a RabbitMQ queue/exchange with a unified API.
 *
 * @template TPayload - The typed payload
 */
export class RabbitMQChannel<TPayload = unknown> implements ChannelContract<TPayload> {
  public readonly name: string;
  public readonly options: ChannelOptions<TPayload>;

  private amqpChannel: any;
  private readonly subscriptions = new Map<string, RabbitMQSubscription>();
  /** What each subscription consumes with, so a reconnect can re-attach it. */
  private readonly consumers = new Map<
    string,
    { handler: MessageHandler<TPayload>; options?: SubscribeOptions }
  >();
  private asserted = false;

  /**
   * Create a new RabbitMQ channel
   */
  public constructor(name: string, amqpChannel: any, options?: ChannelOptions<TPayload>) {
    this.name = name;
    this.amqpChannel = amqpChannel;
    this.options = options ?? {};
  }

  /**
   * Assert the queue exists
   */
  public async assert(): Promise<void> {
    if (this.asserted) return;

    const queueOptions = {
      durable: this.options.durable ?? true,
      autoDelete: this.options.autoDelete ?? false,
      exclusive: this.options.exclusive ?? false,
      messageTtl: this.options.messageTtl,
      maxLength: this.options.maxLength,
      deadLetterExchange: this.options.deadLetter?.channel ? "" : undefined,
      deadLetterRoutingKey: this.options.deadLetter?.channel,
    };

    await this.amqpChannel.assertQueue(this.name, queueOptions);
    this.asserted = true;
  }

  /**
   * Publish a message
   */
  public async publish(payload: TPayload, options?: PublishOptions): Promise<void> {
    await this.assert();

    // Validate with schema if provided
    if (this.options.schema) {
      const context = {
        allValues: payload,
        value: payload,
      };
      const result = await v.validate(this.options.schema, payload, { context });
      if (!result.isValid) {
        throw new Error(`Message validation failed: ${JSON.stringify(result.errors)}`);
      }
      payload = result.data as TPayload;
    }

    const messageId = randomUUID();
    const timestamp = new Date();

    const messageContent = JSON.stringify({
      payload,
      metadata: {
        messageId,
        timestamp: timestamp.toISOString(),
        correlationId: options?.correlationId,
        headers: options?.headers,
      },
    });

    const publishOptions: any = {
      persistent: options?.persistent ?? true,
      messageId,
      timestamp: timestamp.getTime(),
      correlationId: options?.correlationId,
      expiration: options?.expiration?.toString(),
      priority: options?.priority,
      headers: options?.headers,
    };

    // Handle delayed messages (requires rabbitmq-delayed-message-exchange plugin)
    if (options?.delay) {
      publishOptions.headers = {
        ...publishOptions.headers,
        "x-delay": options.delay,
      };
    }

    this.amqpChannel.sendToQueue(this.name, Buffer.from(messageContent), publishOptions);
  }

  /**
   * Publish multiple messages
   */
  public async publishBatch(messages: TPayload[], options?: PublishOptions): Promise<void> {
    for (const payload of messages) {
      await this.publish(payload, options);
    }
  }

  /**
   * Subscribe to messages
   *
   * Smart auto-ack behavior (when autoAck is not true):
   * - If handler completes successfully without explicit ack/nack/reject → auto-ack
   * - If handler throws an error → auto-nack (with retry if configured)
   * - If handler explicitly calls ack/nack/reject → respects that call
   */
  public async subscribe(
    handler: MessageHandler<TPayload>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    await this.assert();

    // Use consumerId from options if provided, otherwise generate a random one
    const subscriptionId = options?.consumerId ?? randomUUID();

    const consumerTag = await this.startConsumer(handler, options, subscriptionId);

    const subscription = new RabbitMQSubscription(
      subscriptionId,
      this.name,
      consumerTag,
      this.amqpChannel,
    );

    this.subscriptions.set(subscriptionId, subscription);
    this.consumers.set(subscriptionId, { handler, options });

    return subscription;
  }

  /**
   * Point this channel at a new AMQP channel after a reconnect: the queue is
   * asserted again and every active subscription is re-attached, so publishes
   * and consumers keep working instead of using the closed channel.
   *
   * @internal Called by the driver.
   */
  public async rebind(amqpChannel: any): Promise<void> {
    if (amqpChannel === this.amqpChannel) return;

    this.amqpChannel = amqpChannel;
    this.asserted = false;

    if (this.subscriptions.size === 0) return;

    await this.assert();

    for (const [subscriptionId, subscription] of this.subscriptions) {
      const consumer = this.consumers.get(subscriptionId);

      if (!consumer || !subscription.isActive() || subscription.isPaused()) continue;

      const consumerTag = await this.startConsumer(
        consumer.handler,
        consumer.options,
        subscriptionId,
      );

      subscription.rebind(consumerTag, amqpChannel);
    }
  }

  /**
   * Start an AMQP consumer for a subscription and return its consumer tag.
   */
  private async startConsumer(
    handler: MessageHandler<TPayload>,
    options: SubscribeOptions | undefined,
    subscriptionId: string,
  ): Promise<string> {
    // Set prefetch if specified
    if (options?.prefetch) {
      await this.amqpChannel.prefetch(options.prefetch);
    }

    // If autoAck is true, RabbitMQ handles ack immediately (fire-and-forget)
    const isFireAndForget = options?.autoAck === true;

    const consumerOptions = {
      noAck: isFireAndForget,
      exclusive: options?.exclusive ?? false,
      consumerTag: options?.group ?? subscriptionId,
    };

    const { consumerTag } = await this.amqpChannel.consume(
      this.name,
      async (msg: any) => {
        if (!msg) return;

        // Track if acknowledgment was handled explicitly
        let ackHandled = isFireAndForget;

        // Populated once the message is successfully parsed, so the catch
        // block below can dead-letter with the full envelope. Stays
        // `undefined` when `JSON.parse` itself is what threw.
        let parsedMessage: Message<TPayload> | undefined;

        try {
          const content = JSON.parse(msg.content.toString());
          let payload = content.payload as TPayload;

          // Validate with schema if provided
          if (this.options.schema) {
            const context = {
              allValues: payload,
              value: payload,
            };
            const result = await v.validate(this.options.schema, payload, { context });
            if (!result.isValid) {
              // Reject invalid messages
              this.amqpChannel.nack(msg, false, false);
              return;
            }
            payload = result.data as TPayload;
          }

          const metadata: MessageMetadata = {
            messageId: msg.properties.messageId || content.metadata?.messageId || randomUUID(),
            timestamp: new Date(msg.properties.timestamp || content.metadata?.timestamp),
            correlationId: msg.properties.correlationId || content.metadata?.correlationId,
            replyTo: msg.properties.replyTo,
            priority: msg.properties.priority,
            headers: msg.properties.headers,
            retryCount: readRetryCount(
              msg.properties.headers?.["x-retry-count"],
              options?.retry?.maxRetries ?? 3,
            ),
            originalChannel: this.name,
          };

          const message: Message<TPayload> = {
            metadata,
            payload,
            raw: msg,
          };

          parsedMessage = message;

          const context: MessageContext = {
            ack: async () => {
              if (!ackHandled) {
                ackHandled = true;
                this.amqpChannel.ack(msg);
              }
            },
            nack: async (requeue = true) => {
              if (!ackHandled) {
                ackHandled = true;
                this.amqpChannel.nack(msg, false, requeue);
              }
            },
            reject: async () => {
              if (!ackHandled) {
                ackHandled = true;
                this.amqpChannel.reject(msg, false);
              }
            },
            reply: async <T>(replyPayload: T) => {
              if (msg.properties.replyTo) {
                const replyContent = JSON.stringify({
                  payload: replyPayload,
                  metadata: {
                    messageId: randomUUID(),
                    timestamp: new Date().toISOString(),
                    correlationId: msg.properties.correlationId,
                  },
                });

                this.amqpChannel.sendToQueue(msg.properties.replyTo, Buffer.from(replyContent), {
                  correlationId: msg.properties.correlationId,
                });
              }
            },
            retry: async (delay?: number) => {
              if (ackHandled) return;
              ackHandled = true;

              await this.retryOrGiveUp(msg, metadata.retryCount || 0, options, message, delay);
            },
          };

          // Execute handler
          await handler(message, context);

          // Smart auto-ack: if handler succeeded and didn't explicitly handle ack
          if (!ackHandled) {
            this.amqpChannel.ack(msg);
          }
        } catch (error) {
          // Smart auto-nack: if handler threw and didn't explicitly handle ack
          if (ackHandled) return;

          if (options?.retry) {
            // A bare `nack(msg, false, true)` redelivers the ORIGINAL message
            // untouched — amqplib/RabbitMQ do not add an `x-retry-count`
            // header on requeue, so a plain requeue here never advances the
            // counter and `maxRetries`/`deadLetter` are silently never
            // reached. Route through the same bounded-retry path `ctx.retry()`
            // uses, so the counter increments (and the cap/dead-letter fires)
            // on this automatic path too.
            const currentRetryCount = readRetryCount(
              msg.properties.headers?.["x-retry-count"],
              options?.retry?.maxRetries ?? 3,
            );
            await this.retryOrGiveUp(msg, currentRetryCount, options, parsedMessage);
          } else {
            // No retry configured - reject without requeue (already bounded:
            // a single attempt, no requeue loop possible).
            this.amqpChannel.nack(msg, false, false);
          }
        }
      },
      consumerOptions,
    );

    return consumerTag;
  }

  /**
   * Unsubscribe by consumer ID
   */
  public async unsubscribeById(consumerId: string): Promise<void> {
    const subscription = this.subscriptions.get(consumerId);
    if (subscription) {
      await subscription.unsubscribe();
      this.subscriptions.delete(consumerId);
      this.consumers.delete(consumerId);
    }
  }

  /**
   * Stop consuming messages on this channel.
   * Cancels all active subscriptions gracefully.
   */
  public async stopConsuming(): Promise<void> {
    const cancellations = Array.from(this.subscriptions.values()).map((sub) => sub.unsubscribe());
    await Promise.all(cancellations);
  }

  /**
   * Send message to dead-letter queue
   */
  private async sendToDeadLetter(
    message: Message<TPayload>,
    deadLetterChannel: string,
  ): Promise<void> {
    const content = JSON.stringify({
      payload: message.payload,
      metadata: {
        ...message.metadata,
        originalChannel: this.name,
      },
    });

    this.amqpChannel.sendToQueue(deadLetterChannel, Buffer.from(content), { persistent: true });
  }

  /**
   * Dead-letter a message whose body couldn't be parsed into a {@link Message}
   * (e.g. `JSON.parse` itself threw before an envelope existed). Forwards the
   * raw AMQP bytes/properties as-is rather than re-deriving a payload, so a
   * malformed message isn't lost.
   */
  private sendToDeadLetterRaw(msg: any, deadLetterChannel: string): void {
    this.amqpChannel.sendToQueue(deadLetterChannel, msg.content, {
      ...msg.properties,
      persistent: true,
    });
  }

  /**
   * Bounded retry shared by the explicit `ctx.retry()` call and the automatic
   * catch when a handler throws without calling it itself — so both paths
   * honor the same cap instead of the automatic path silently requeueing
   * forever (see `subscribe()`'s catch block).
   *
   * Under the cap: republishes with an incremented `x-retry-count` header —
   * NOT a plain `nack(msg, false, true)`, which redelivers the original
   * message untouched and never advances the counter.
   *
   * At/over the cap: dead-letters if configured, otherwise drops the message
   * with a loud `log.error` (never a silent drop) so an operator can see a
   * poison message was discarded instead of it vanishing without a trace.
   */
  private async retryOrGiveUp(
    msg: any,
    currentRetryCount: number,
    options: SubscribeOptions | undefined,
    parsedMessage: Message<TPayload> | undefined,
    delay?: number,
  ): Promise<void> {
    const retryCount = currentRetryCount + 1;
    const maxRetries = options?.retry?.maxRetries ?? 3;

    if (retryCount > maxRetries) {
      if (options?.deadLetter) {
        if (parsedMessage) {
          await this.sendToDeadLetter(parsedMessage, options.deadLetter.channel);
        } else {
          this.sendToDeadLetterRaw(msg, options.deadLetter.channel);
        }
      } else {
        log.error(
          "herald",
          "poison-message",
          `Dropping message on channel "${this.name}" after ${retryCount - 1} failed ` +
            `${retryCount - 1 === 1 ? "retry" : "retries"} (maxRetries: ${maxRetries}) with no ` +
            `dead-letter channel configured.`,
          { channel: this.name, retryCount: retryCount - 1, maxRetries },
        );
        this.amqpChannel.reject(msg, false);
        return;
      }

      this.amqpChannel.ack(msg);
      return;
    }

    const headers: Record<string, unknown> = {
      ...msg.properties.headers,
      "x-retry-count": retryCount,
    };

    if (delay) {
      headers["x-delay"] = delay;
    }

    this.amqpChannel.sendToQueue(this.name, msg.content, { ...msg.properties, headers });

    this.amqpChannel.ack(msg);
  }

  /**
   * Request-response pattern
   *
   * Replies come back over RabbitMQ's direct reply-to: one reply consumer per
   * AMQP channel, shared by every request, with each pending request tracked
   * by its correlation id until its reply or its timeout. No queue or consumer
   * is created per call.
   */
  public async request<TResponse = unknown>(
    payload: TPayload,
    options?: RequestOptions,
  ): Promise<TResponse> {
    await this.assert();

    const replies = replyRouterFor(this.amqpChannel);
    await replies.start();

    const correlationId = randomUUID();
    const timeout = options?.timeout ?? 30000;

    return new Promise<TResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        replies.pending.delete(correlationId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      replies.pending.set(correlationId, {
        resolve: (reply) => resolve(reply as TResponse),
        reject,
        timer,
      });

      // Send request
      const messageContent = JSON.stringify({
        payload,
        metadata: {
          messageId: randomUUID(),
          timestamp: new Date().toISOString(),
          correlationId,
        },
      });

      try {
        // Only known AMQP properties: `timeout` and the other request options
        // are not message properties, and the correlation id is always ours.
        this.amqpChannel.sendToQueue(this.name, Buffer.from(messageContent), {
          correlationId,
          replyTo: DIRECT_REPLY_TO,
          expiration: String(options?.expiration ?? timeout),
          priority: options?.priority,
          persistent: options?.persistent,
          headers: options?.headers,
        });
      } catch (error) {
        clearTimeout(timer);
        replies.pending.delete(correlationId);
        reject(error);
      }
    });
  }

  /**
   * Register response handler for RPC
   */
  public async respond<TResponse = unknown>(
    handler: ResponseHandler<TPayload, TResponse>,
  ): Promise<Subscription> {
    return this.subscribe(async (message, ctx) => {
      const response = await handler(message, ctx);
      await ctx.reply(response);
      await ctx.ack();
    });
  }

  /**
   * Get queue statistics
   */
  public async stats(): Promise<ChannelStats> {
    await this.assert();

    const queueInfo = await this.amqpChannel.checkQueue(this.name);

    return {
      name: this.name,
      messageCount: queueInfo.messageCount,
      consumerCount: queueInfo.consumerCount,
    };
  }

  /**
   * Purge all messages
   */
  public async purge(): Promise<number> {
    await this.assert();

    const result = await this.amqpChannel.purgeQueue(this.name);
    return result.messageCount;
  }

  /**
   * Check if queue exists
   */
  public async exists(): Promise<boolean> {
    try {
      await this.amqpChannel.checkQueue(this.name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the queue
   */
  public async delete(): Promise<void> {
    // Cancel all subscriptions
    for (const subscription of this.subscriptions.values()) {
      await subscription.unsubscribe();
    }
    this.subscriptions.clear();
    this.consumers.clear();

    try {
      await this.amqpChannel.deleteQueue(this.name);
    } catch {
      // Ignore if queue doesn't exist
    }

    this.asserted = false;
  }
}

/**
 * RabbitMQ's pseudo-queue for direct replies: replies reach the consumer on the
 * requesting AMQP channel without a queue being declared.
 */
const DIRECT_REPLY_TO = "amq.rabbitmq.reply-to";

type PendingReply = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Routes direct replies on one AMQP channel to the request waiting for them.
 * RabbitMQ allows a single direct reply-to consumer per AMQP channel, so every
 * herald channel on that AMQP channel shares one router.
 */
class ReplyRouter {
  public readonly pending = new Map<string, PendingReply>();
  private consuming?: Promise<void>;

  public constructor(private readonly amqpChannel: any) {}

  /** Start the shared reply consumer once; a failed start is retried by the next request. */
  public start(): Promise<void> {
    if (!this.consuming) {
      const consuming = Promise.resolve(
        this.amqpChannel.consume(DIRECT_REPLY_TO, (msg: any) => this.route(msg), { noAck: true }),
      ).then(() => undefined);

      consuming.catch(() => {
        if (this.consuming === consuming) this.consuming = undefined;
      });

      this.consuming = consuming;
    }

    return this.consuming;
  }

  private route(msg: any): void {
    const correlationId = msg?.properties?.correlationId;
    const entry = correlationId ? this.pending.get(correlationId) : undefined;

    // A reply nobody waits for (late, after its timeout) is dropped.
    if (!entry) return;

    this.pending.delete(correlationId);
    clearTimeout(entry.timer);

    let content: { payload?: unknown };

    try {
      content = JSON.parse(msg.content.toString());
    } catch {
      entry.reject(
        new Error(
          "The reply to this request is not valid JSON. Check that the responder replies through `ctx.reply()` or `respond()`.",
        ),
      );
      return;
    }

    entry.resolve(content?.payload);
  }
}

const replyRouters = new WeakMap<object, ReplyRouter>();

function replyRouterFor(amqpChannel: any): ReplyRouter {
  let router = replyRouters.get(amqpChannel);

  if (!router) {
    router = new ReplyRouter(amqpChannel);
    replyRouters.set(amqpChannel, router);
  }

  return router;
}

/**
 * Read the `x-retry-count` header. The header comes from whoever published the
 * message, so anything that is not a non-negative integer counts as retries
 * exhausted: a forged value can never make the retry loop unbounded.
 */
function readRetryCount(raw: unknown, maxRetries: number): number {
  if (raw === undefined || raw === null) return 0;

  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : maxRetries;
}

/**
 * RabbitMQ Subscription Implementation
 */
class RabbitMQSubscription implements Subscription {
  public readonly id: string;
  public readonly channel: string;
  public consumerTag: string;

  private amqpChannel: any;
  private _isActive = true;
  private _isPaused = false;

  public constructor(id: string, channel: string, consumerTag: string, amqpChannel: any) {
    this.id = id;
    this.channel = channel;
    this.consumerTag = consumerTag;
    this.amqpChannel = amqpChannel;
  }

  public async unsubscribe(): Promise<void> {
    if (!this._isActive) return;

    await this.amqpChannel.cancel(this.consumerTag);
    this._isActive = false;
  }

  public async pause(): Promise<void> {
    // RabbitMQ doesn't have native pause, cancel consumer
    await this.amqpChannel.cancel(this.consumerTag);
    this._isPaused = true;
  }

  public async resume(): Promise<void> {
    // Would need to re-subscribe - not directly supported
    throw new Error("Resume is not supported for RabbitMQ. Please create a new subscription.");
  }

  public isActive(): boolean {
    return this._isActive;
  }

  /** Whether `pause()` cancelled the consumer (a reconnect leaves it paused). */
  public isPaused(): boolean {
    return this._isPaused;
  }

  /** Follow the consumer re-attached on a new AMQP channel after a reconnect. */
  public rebind(consumerTag: string, amqpChannel: any): void {
    this.consumerTag = consumerTag;
    this.amqpChannel = amqpChannel;
  }
}
