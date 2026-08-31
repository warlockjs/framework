import { EventEmitter } from "node:events";
import type { BrokerDriverContract, ChannelContract } from "../../contracts";
import { EventMessage } from "../../message-managers/event-message";
import { type EventConsumerClass } from "../../message-managers/types";
import type {
  BrokerDriverType,
  BrokerEvent,
  BrokerEventListener,
  ChannelOptions,
  HealthCheckResult,
  RabbitMQConnectionOptions,
} from "../../types";
import { prepareConsumerSubscription } from "./../../message-managers/prepare-consumer-subscription";
import { RabbitMQChannel } from "./rabbitmq-channel";

// ============================================================
// Lazy-loaded amqplib Module
// ============================================================

/**
 * Shape of the lazily-imported amqplib module
 */
type AmqplibModule = typeof import("amqplib");

/**
 * The single amqplib load, shared by every caller.
 *
 * Memoized as a promise rather than as a resolved value so the loader stays
 * idempotent: without it, two callers arriving before the first `import()`
 * settles would each start their own load and the last writer would win, so a
 * caller could end up observing a module instance it never awaited.
 *
 * Resolves to `undefined` when amqplib is not installed.
 */
let amqplibModulePromise: Promise<AmqplibModule | undefined> | undefined;

/**
 * Installation instructions for amqplib
 */
const AMQPLIB_INSTALL_INSTRUCTIONS = `
RabbitMQ driver requires the amqplib package.
Install it with:

  npx warlock add herald --driver=rabbitmq

Or manually:

  npm install amqplib
  pnpm add amqplib
  yarn add amqplib
`.trim();

/**
 * Strip `user:password@` credentials from any `amqp(s)://` URL embedded in a
 * string. The connection URL carries plaintext broker credentials, and
 * amqplib/Node's URL parser commonly echoes the offending URL verbatim in a
 * malformed-URL error (e.g. an unencoded `@`/`:` in the password) — applied
 * to every error `connect()` surfaces so a credential never reaches whatever
 * the host app does with a thrown connection error (console.error,
 * structured logging, an error tracker).
 */
function redactAmqpCredentials(message: string): string {
  return message.replace(/(amqps?:\/\/)[^/@\s]+@/gi, "$1****:****@");
}

/**
 * Load amqplib, reusing the single shared load for every caller.
 *
 * @returns The amqplib module, or `undefined` when it is not installed.
 */
function loadAmqplibModule(): Promise<AmqplibModule | undefined> {
  if (!amqplibModulePromise) {
    amqplibModulePromise = import("amqplib").catch(() => undefined);
  }

  return amqplibModulePromise;
}

// ============================================================
// RabbitMQ Driver
// ============================================================

/**
 * RabbitMQ Driver
 *
 * Implementation of BrokerDriverContract for RabbitMQ/AMQP.
 *
 * **Important:** This driver requires the `amqplib` package to be installed.
 * Install it with: `npx warlock add herald --driver=rabbitmq` or `npm install amqplib`
 *
 * @example
 * ```typescript
 * const driver = new RabbitMQDriver({
 *   driver: "rabbitmq",
 *   host: "localhost",
 *   port: 5672,
 *   username: "guest",
 *   password: "guest",
 * });
 *
 * await driver.connect();
 * const channel = driver.channel("user.created");
 * ```
 */
export class RabbitMQDriver implements BrokerDriverContract {
  public readonly name = "rabbitmq" as const;

  public readonly consumers: EventConsumerClass[] = [];

  private readonly options: RabbitMQConnectionOptions;
  private readonly events = new EventEmitter();
  private readonly channels = new Map<string, ChannelContract<any>>();

  private connection: any = null;
  private amqpChannel: any = null;
  private _isConnected = false;

  /**
   * Create a new RabbitMQ driver
   *
   * @param options - RabbitMQ connection options
   */
  public constructor(options: RabbitMQConnectionOptions) {
    this.options = options;
  }

  /**
   * Whether connected to RabbitMQ
   */
  public get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Subscribe the given consumer class to the driver
   *
   * @param consumer - Consumer class to subscribe
   *
   * @example
   * ```typescript
   * driver.subscribe(UserUpdatedConsumer);
   * ```
   */
  public subscribe(Consumer: EventConsumerClass) {
    if (this.isConnected) {
      this.channel(Consumer.eventName).subscribe(
        prepareConsumerSubscription(Consumer, (error, eventName) => {
          this.events.emit("error", error, eventName);
        }),
        {
          consumerId: Consumer.consumerId,
        },
      );
    } else {
      this.consumers.push(Consumer);
    }

    return () => {
      this.unsubscribe(Consumer);
    };
  }

  /**
   * Unsubscribe the given consumer
   */
  public unsubscribe(Consumer: EventConsumerClass): void {
    if (this.isConnected) {
      this.channel(Consumer.eventName).unsubscribeById(Consumer.consumerId);
    }
    const index = this.consumers.indexOf(Consumer);
    if (index > -1) {
      this.consumers.splice(index, 1);
    }
  }

  /**
   * Publish the given event message.
   * Auto-creates the channel if it hasn't been accessed before.
   */
  public publish<TPayload = Record<string, any>>(event: EventMessage<TPayload>): void {
    this.channel(event.eventName).publish(event.serialize());
  }

  /**
   * Connect to RabbitMQ
   */
  public async connect(): Promise<void> {
    const amqplib = await loadAmqplibModule();

    if (!amqplib) {
      throw new Error(`amqplib is not installed.\n\n${AMQPLIB_INSTALL_INSTRUCTIONS}`);
    }

    try {
      // Build connection URL
      const url = this.buildConnectionUrl();

      // Build connection options merging our options with native client options
      const connectOptions = {
        heartbeat: this.options.heartbeat ?? 60,
        timeout: this.options.connectionTimeout,
        // Merge native amqplib client options
        ...this.options.clientOptions,
      };

      // Connect using cached module
      this.connection = await amqplib.connect(url, connectOptions);

      // Create channel
      this.amqpChannel = await this.connection.createChannel();

      // Set prefetch if specified
      if (this.options.prefetch) {
        await this.amqpChannel.prefetch(this.options.prefetch);
      }

      this._isConnected = true;
      this.events.emit("connected");

      for (const consumer of this.consumers) {
        this.subscribe(consumer);
      }

      this.consumers.length = 0;

      // Handle connection close
      this.connection.on("close", () => {
        this._isConnected = false;
        this.events.emit("disconnected");

        if (this.options.reconnect !== false) {
          this.handleReconnect();
        }
      });

      // Handle errors
      this.connection.on("error", (error: Error) => {
        this.events.emit("error", error);
      });
    } catch (error) {
      this._isConnected = false;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to RabbitMQ: ${redactAmqpCredentials(message)}`);
    }
  }

  /**
   * Build connection URL from options
   */
  private buildConnectionUrl(): string {
    if (this.options.uri) {
      return this.options.uri;
    }

    const protocol = "amqp";
    const host = this.options.host ?? "localhost";
    const port = this.options.port ?? 5672;
    const vhost = this.options.vhost ?? "/";
    // URI-encoded so a credential containing a reserved URL character
    // (`@`, `:`, `/`, whitespace — common in generated secrets) can't produce
    // a malformed URL whose parser error echoes the raw credential back.
    const username = encodeURIComponent(this.options.username ?? "guest");
    const password = encodeURIComponent(this.options.password ?? "guest");

    const encodedVhost = encodeURIComponent(vhost);

    return `${protocol}://${username}:${password}@${host}:${port}/${encodedVhost}`;
  }

  /**
   * Handle reconnection
   */
  private async handleReconnect(): Promise<void> {
    const delay = this.options.reconnectDelay ?? 5000;
    let attempt = 0;

    const tryReconnect = async () => {
      attempt++;
      this.events.emit("reconnecting", attempt);

      try {
        await this.connect();
      } catch {
        setTimeout(tryReconnect, delay);
      }
    };

    setTimeout(tryReconnect, delay);
  }

  /**
   * Disconnect from RabbitMQ
   */
  public async disconnect(): Promise<void> {
    if (this.amqpChannel) {
      try {
        await this.amqpChannel.close();
      } catch {
        // Ignore close errors
      }
      this.amqpChannel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch {
        // Ignore close errors
      }
      this.connection = null;
    }

    this._isConnected = false;
    this.events.emit("disconnected");
  }

  /**
   * Register event listener
   */
  public on(event: BrokerEvent, listener: BrokerEventListener): void {
    this.events.on(event, listener as any);
  }

  /**
   * Remove event listener
   */
  public off(event: BrokerEvent, listener: BrokerEventListener): void {
    this.events.off(event, listener as any);
  }

  /**
   * Get or create a channel
   */
  public channel<TPayload = unknown>(
    name: string,
    options?: ChannelOptions<TPayload>,
  ): ChannelContract<TPayload> {
    // Check cache
    const existing = this.channels.get(name);
    if (existing) {
      return existing as ChannelContract<TPayload>;
    }

    // Create new channel
    const channel = new RabbitMQChannel<TPayload>(name, this.amqpChannel, options);

    this.channels.set(name, channel);
    return channel;
  }

  /**
   * Start consuming messages
   */
  public async startConsuming(): Promise<void> {
    // Channels start consuming when subscribe() is called
    // This method is for batch start if needed
  }

  /**
   * Stop consuming messages from all subscribed channels.
   * Gracefully cancels all active consumers.
   */
  public async stopConsuming(): Promise<void> {
    const stops = Array.from(this.channels.values()).map(channel =>
      (channel as RabbitMQChannel<any>).stopConsuming(),
    );
    await Promise.all(stops);
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    if (!this._isConnected || !this.connection) {
      return {
        healthy: false,
        error: "Not connected to RabbitMQ",
      };
    }

    const start = Date.now();

    try {
      // Simple check - verify channel is open
      await this.amqpChannel.checkQueue("amq.rabbitmq.reply-to").catch(() => {
        // Queue might not exist, but if we get here, connection is alive
      });

      return {
        healthy: true,
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Get all channel names
   */
  public getChannelNames(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Close a specific channel
   */
  public async closeChannel(name: string): Promise<void> {
    const channel = this.channels.get(name);
    if (channel) {
      await channel.delete();
      this.channels.delete(name);
    }
  }

  /**
   * Get the raw AMQP channel (for advanced use)
   */
  public getRawChannel(): any {
    return this.amqpChannel;
  }

  /**
   * Get the raw connection (for advanced use)
   */
  public getRawConnection(): any {
    return this.connection;
  }
}
