import type { CommunicatorDriverContract } from "../contracts";
import type { ChannelOptions } from "../types";
import type { ChannelContract } from "../contracts/channel.contract";

/**
 * Options for creating a Communicator
 */
export interface CommunicatorOptions {
  /** Unique name for this communicator */
  name: string;
  /** The underlying driver */
  driver: CommunicatorDriverContract;
  /** Whether this is the default communicator */
  isDefault?: boolean;
}

/**
 * Communicator - wrapper around a driver with metadata
 *
 * Similar to DataSource in @warlock.js/cascade
 *
 * @example
 * ```typescript
 * const communicator = new Communicator({
 *   name: "default",
 *   driver: rabbitMQDriver,
 *   isDefault: true,
 * });
 *
 * // Get a channel
 * const channel = communicator.channel("user.created");
 * ```
 */
export class Communicator {
  /** Unique name identifying this communicator */
  public readonly name: string;

  /** The underlying driver */
  public readonly driver: CommunicatorDriverContract;

  /** Whether this is the default communicator */
  public readonly isDefault: boolean;

  /**
   * Create a new Communicator
   *
   * @param options - Communicator configuration
   */
  public constructor(options: CommunicatorOptions) {
    this.name = options.name;
    this.driver = options.driver;
    this.isDefault = Boolean(options.isDefault);
  }

  /**
   * Get or create a channel
   *
   * @param name - Channel name
   * @param options - Channel options
   * @returns Channel instance
   *
   * @example
   * ```typescript
   * // Simple channel
   * const channel = communicator.channel("notifications");
   *
   * // Typed channel with schema
   * const orderChannel = communicator.channel<OrderPayload>("orders", {
   *   schema: OrderSchema,
   *   durable: true,
   * });
   * ```
   */
  public channel<TPayload = unknown>(
    name: string,
    options?: ChannelOptions<TPayload>,
  ): ChannelContract<TPayload> {
    return this.driver.channel<TPayload>(name, options);
  }

  /**
   * Check if the communicator is connected
   */
  public get isConnected(): boolean {
    return this.driver.isConnected;
  }

  /**
   * Connect the underlying driver
   */
  public async connect(): Promise<void> {
    await this.driver.connect();
  }

  /**
   * Disconnect the underlying driver
   */
  public async disconnect(): Promise<void> {
    await this.driver.disconnect();
  }

  /**
   * Start consuming messages
   */
  public async startConsuming(): Promise<void> {
    await this.driver.startConsuming();
  }

  /**
   * Stop consuming messages
   */
  public async stopConsuming(): Promise<void> {
    await this.driver.stopConsuming();
  }

  /**
   * Health check
   */
  public async healthCheck() {
    return this.driver.healthCheck();
  }
}
