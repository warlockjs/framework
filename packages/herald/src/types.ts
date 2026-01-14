import type { BaseValidator } from "@warlock.js/seal";
import { CommunicatorDriverContract } from "./contracts";

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message metadata that accompanies every message
 */
export type MessageMetadata = {
  /** Unique message ID (auto-generated) */
  messageId: string;
  /** Correlation ID for request-response patterns */
  correlationId?: string;
  /** Reply-to channel for RPC patterns */
  replyTo?: string;
  /** Message priority (0-9, where 9 is highest) */
  priority?: number;
  /** Timestamp when message was published */
  timestamp: Date;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Retry count (incremented on each retry) */
  retryCount?: number;
  /** Original queue/channel name */
  originalChannel?: string;
};

/**
 * A message received from a channel
 *
 * @template TPayload - The typed payload
 */
export type Message<TPayload = unknown> = {
  /** Message metadata */
  readonly metadata: MessageMetadata;
  /** Typed payload data */
  readonly payload: TPayload;
  /** Raw message data from the driver */
  readonly raw?: unknown;
};

// ============================================================================
// PUBLISH OPTIONS
// ============================================================================

/**
 * Options when publishing a message
 */
export type PublishOptions = {
  /** Message priority (0-9, where 9 is highest) */
  priority?: number;
  /** Time-to-live in milliseconds */
  ttl?: number;
  /** Delay before message is available (delayed messaging) */
  delay?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Enable message persistence (survives broker restart) */
  persistent?: boolean;
  /** Correlation ID for tracking related messages */
  correlationId?: string;
  /** Expiration time in milliseconds */
  expiration?: number;
};

// ============================================================================
// SUBSCRIBE OPTIONS
// ============================================================================

/**
 * Retry configuration for failed message processing
 */
export type RetryOptions = {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in ms, or function for custom backoff */
  delay: number | ((attempt: number) => number);
};

/**
 * Dead-letter configuration for messages that exceed retry attempts
 */
export type DeadLetterOptions = {
  /** Dead-letter queue/channel name */
  channel: string;
  /** Whether to preserve original message metadata */
  preserveOriginal?: boolean;
};

/**
 * Options when subscribing to a channel
 */
export type SubscribeOptions = {
  /** Consumer ID for tracking subscriptions (used for unsubscription) */
  consumerId?: string;
  /** Consumer group/tag name */
  group?: string;
  /** Number of messages to prefetch (concurrency) */
  prefetch?: number;
  /** Auto-acknowledge messages (default: false for manual ack) */
  autoAck?: boolean;
  /** Retry configuration for failed messages */
  retry?: RetryOptions;
  /** Dead-letter configuration */
  deadLetter?: DeadLetterOptions;
  /** Exclusive consumer (only one consumer on this queue) */
  exclusive?: boolean;
};

/**
 * Options for request-response (RPC) pattern
 */
export type RequestOptions = PublishOptions & {
  /** Timeout in milliseconds to wait for response */
  timeout?: number;
};

// ============================================================================
// MESSAGE CONTEXT
// ============================================================================

/**
 * Context provided to message handlers for controlling message flow
 */
export type MessageContext = {
  /** Acknowledge the message (mark as successfully processed) */
  ack(): Promise<void>;
  /** Negative acknowledge (requeue or send to dead-letter) */
  nack(requeue?: boolean): Promise<void>;
  /** Reject the message (don't requeue) */
  reject(): Promise<void>;
  /** Reply to a message (for RPC patterns) */
  reply<T>(payload: T): Promise<void>;
  /** Manually retry the message with optional delay */
  retry(delay?: number): Promise<void>;
};

// ============================================================================
// SUBSCRIPTION
// ============================================================================

/**
 * Represents an active subscription to a channel
 */
export type Subscription = {
  /** Unique subscription ID */
  readonly id: string;
  /** Channel name this subscription is for */
  readonly channel: string;
  /** Consumer tag (driver-specific identifier) */
  readonly consumerTag?: string;
  /** Unsubscribe from the channel */
  unsubscribe(): Promise<void>;
  /** Pause message consumption */
  pause(): Promise<void>;
  /** Resume message consumption */
  resume(): Promise<void>;
  /** Check if subscription is active */
  isActive(): boolean;
};

// ============================================================================
// HANDLER TYPES
// ============================================================================

/**
 * Handler function for processing messages
 *
 * @template TPayload - The typed payload
 */
export type MessageHandler<TPayload = unknown> = (
  message: Message<TPayload>,
  ctx: MessageContext,
) => Promise<void> | void;

/**
 * Handler function for request-response (RPC) pattern
 *
 * @template TPayload - The request payload type
 * @template TResponse - The response payload type
 */
export type ResponseHandler<TPayload = unknown, TResponse = unknown> = (
  message: Message<TPayload>,
  ctx: MessageContext,
) => Promise<TResponse> | TResponse;

// ============================================================================
// CHANNEL OPTIONS
// ============================================================================

/**
 * Channel/queue configuration options
 */
export type ChannelOptions<TPayload = unknown> = {
  /** Channel type (queue for point-to-point, topic for pub/sub, fanout for broadcast) */
  type?: "queue" | "topic" | "fanout";
  /** Durable channel (survives broker restart) */
  durable?: boolean;
  /** Auto-delete when last consumer disconnects */
  autoDelete?: boolean;
  /** Exclusive channel (single connection only) */
  exclusive?: boolean;
  /** Dead-letter configuration */
  deadLetter?: DeadLetterOptions;
  /** Maximum message size in bytes */
  maxMessageSize?: number;
  /** Default message TTL in milliseconds */
  messageTtl?: number;
  /** Maximum number of messages in queue */
  maxLength?: number;
  /** Seal schema for validation before message is published */
  schema?: BaseValidator;
};

// ============================================================================
// CHANNEL STATS
// ============================================================================

/**
 * Statistics for a channel
 */
export type ChannelStats = {
  /** Number of messages in the queue */
  messageCount: number;
  /** Number of active consumers */
  consumerCount: number;
  /** Channel name */
  name: string;
};

// ============================================================================
// DRIVER TYPES
// ============================================================================

/**
 * Supported communicator driver types
 */
export type CommunicatorDriverType = "rabbitmq" | "kafka" | "redis-streams" | "sqs";

/**
 * Events emitted by communicator drivers
 */
export type CommunicatorEvent = "connected" | "disconnected" | "error" | "reconnecting";

/**
 * Listener function for communicator events
 */
export type CommunicatorEventListener = (...args: unknown[]) => void;

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Result of a health check
 */
export type HealthCheckResult = {
  /** Whether the communicator is healthy */
  healthy: boolean;
  /** Latency in milliseconds */
  latency?: number;
  /** Error message if unhealthy */
  error?: string;
  /** Additional details */
  details?: Record<string, unknown>;
};

// ============================================================================
// CONNECTION OPTIONS
// ============================================================================

/**
 * Base connection options shared across all drivers
 */
export type BaseConnectionOptions = {
  /** Unique name for this communicator */
  name?: string;
  /** Whether this should be the default communicator */
  isDefault?: boolean;
};

/**
 * Native amqplib socket options
 * These are passed directly to the underlying socket connection
 */
export type RabbitMQSocketOptions = {
  /** Keep-alive delay in milliseconds */
  keepAlive?: boolean | number;
  /** Disable Nagle's algorithm */
  noDelay?: boolean;
  /** Socket timeout in milliseconds */
  timeout?: number;
  /** Custom certificate authority (for TLS) */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Client certificate (for TLS) */
  cert?: string | Buffer;
  /** Client private key (for TLS) */
  key?: string | Buffer;
  /** Passphrase for the private key */
  passphrase?: string;
  /** Server name for SNI (TLS) */
  servername?: string;
  /** Reject unauthorized certificates (default: true) */
  rejectUnauthorized?: boolean;
};

/**
 * RabbitMQ client options (native amqplib options)
 * These are passed directly to amqplib.connect()
 */
export type RabbitMQClientOptions = {
  /** Frame max size in bytes */
  frameMax?: number;
  /** Channel max (0 = unlimited) */
  channelMax?: number;
  /** Locale (default: 'en_US') */
  locale?: string;
  /** Socket options for the underlying connection */
  socket?: RabbitMQSocketOptions;
};

/**
 * RabbitMQ-specific connection options
 *
 * @template TClientOptions - Native amqplib client options
 *
 * @example
 * ```typescript
 * const config: RabbitMQConnectionOptions = {
 *   driver: "rabbitmq",
 *   host: "localhost",
 *   port: 5672,
 *   username: "guest",
 *   password: "guest",
 *
 *   // Native amqplib options
 *   clientOptions: {
 *     frameMax: 0,
 *     channelMax: 0,
 *     socket: {
 *       keepAlive: true,
 *       noDelay: true,
 *     },
 *   },
 * };
 * ```
 */
export type RabbitMQConnectionOptions<
  TClientOptions extends RabbitMQClientOptions = RabbitMQClientOptions,
> = BaseConnectionOptions & {
  driver: "rabbitmq";
  /** Host address */
  host?: string;
  /** Port number */
  port?: number;
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
  /** Virtual host */
  vhost?: string;
  /** Connection URI (alternative to host/port) */
  uri?: string;
  /** Heartbeat interval in seconds */
  heartbeat?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Enable automatic reconnection */
  reconnect?: boolean;
  /** Delay between reconnection attempts in milliseconds */
  reconnectDelay?: number;
  /** Default prefetch count for consumers */
  prefetch?: number;

  /**
   * Native amqplib client options
   *
   * These options are passed directly to amqplib.connect()
   * for low-level configuration like frame size, TLS, etc.
   */
  clientOptions?: TClientOptions;
};

/**
 * Kafka client options (native kafkajs options)
 */
export type KafkaClientOptions = {
  /** Retry configuration */
  retry?: {
    initialRetryTime?: number;
    retries?: number;
    maxRetryTime?: number;
    factor?: number;
    multiplier?: number;
  };
  /** Log level */
  logLevel?: number;
  /** Custom logger */
  logCreator?: any;
};

/**
 * Kafka-specific connection options
 *
 * @template TClientOptions - Native kafkajs client options
 */
export type KafkaConnectionOptions<TClientOptions extends KafkaClientOptions = KafkaClientOptions> =
  BaseConnectionOptions & {
    driver: "kafka";
    /** Broker addresses */
    brokers: string[];
    /** Client ID */
    clientId?: string;
    /** Connection timeout in milliseconds */
    connectionTimeout?: number;
    /** Request timeout in milliseconds */
    requestTimeout?: number;
    /** SSL configuration */
    ssl?: boolean | object;
    /** SASL authentication */
    sasl?: {
      mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
      username: string;
      password: string;
    };

    /**
     * Native kafkajs client options
     */
    clientOptions?: TClientOptions;
  };

/**
 * Union type for all connection options
 */
export type ConnectionOptions = RabbitMQConnectionOptions | KafkaConnectionOptions;

// ============================================================================
// COMMUNICATOR CONFIGURATIONS (User-facing config type)
// ============================================================================

/**
 * Communicator configuration options
 *
 * This is the main type for configuring communicators in your application.
 * Similar to ConnectionOptions in @warlock.js/cascade.
 *
 * @template TClientOptions - Native client options (amqplib, kafkajs, etc.)
 *
 * @example
 * ```typescript
 * // RabbitMQ with client options
 * const config: CommunicatorConfigurations<RabbitMQClientOptions> = {
 *   driver: "rabbitmq",
 *   host: "localhost",
 *   clientOptions: {
 *     socket: { keepAlive: true },
 *   },
 * };
 *
 * // Kafka
 * const kafkaConfig: CommunicatorConfigurations<KafkaClientOptions> = {
 *   driver: "kafka",
 *   brokers: ["localhost:9092"],
 *   clientOptions: {
 *     retry: { retries: 5 },
 *   },
 * };
 * ```
 */
export type CommunicatorConfigurations<TClientOptions = any> =
  | RabbitMQConnectionOptions<
      TClientOptions extends RabbitMQClientOptions ? TClientOptions : RabbitMQClientOptions
    >
  | KafkaConnectionOptions<
      TClientOptions extends KafkaClientOptions ? TClientOptions : KafkaClientOptions
    >;

// ============================================================================
// REGISTRY TYPES
// ============================================================================

/**
 * Events emitted by the communicator registry
 */
export type CommunicatorRegistryEvent =
  | "registered"
  | "default-registered"
  | "connected"
  | "disconnected";

/**
 * Listener for registry events
 */
export type CommunicatorRegistryListener = (communicator: CommunicatorDriverContract) => void;
