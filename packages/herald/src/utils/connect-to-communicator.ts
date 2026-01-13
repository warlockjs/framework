import { Communicator, communicatorRegistry } from "../communicators";
import type { ChannelContract, CommunicatorDriverContract } from "../contracts";
import type { ChannelOptions, ConnectionOptions, RabbitMQConnectionOptions } from "../types";

/**
 * Connect to a message broker and register the communicator.
 *
 * This is a high-level utility function that simplifies connection setup
 * for most projects. It handles driver instantiation, connection,
 * communicator creation, and automatic registration.
 *
 * **Supported Drivers:**
 * - `rabbitmq` (default) - RabbitMQ/AMQP driver
 * - `kafka` - Apache Kafka driver (coming soon)
 *
 * @param options - Connection configuration options
 * @returns A connected and registered Communicator instance
 * @throws {Error} If connection fails or driver is not implemented
 *
 * @example
 * ```typescript
 * // RabbitMQ connection
 * const communicator = await connectToCommunicator({
 *   driver: "rabbitmq",
 *   host: "localhost",
 *   port: 5672,
 *   username: "guest",
 *   password: "guest",
 * });
 *
 * // Use the communicator
 * await communicator.channel("user.created").publish({ userId: 1 });
 * ```
 *
 * @example
 * ```typescript
 * // Multiple communicators
 * await connectToCommunicator({
 *   driver: "rabbitmq",
 *   name: "notifications",
 *   isDefault: true,
 *   host: process.env.RABBITMQ_HOST,
 * });
 *
 * await connectToCommunicator({
 *   driver: "rabbitmq",
 *   name: "analytics",
 *   host: process.env.ANALYTICS_RABBITMQ_HOST,
 * });
 *
 * // Use default communicator
 * communicators().channel("notifications").publish({ ... });
 *
 * // Use specific communicator
 * communicators("analytics").channel("events").publish({ ... });
 * ```
 */
export async function connectToCommunicator(options: ConnectionOptions): Promise<Communicator> {
  // Default values
  const driverType = options.driver ?? "rabbitmq";
  const communicatorName = options.name ?? "default";
  const isDefault = options.isDefault ?? true;

  // Create driver based on type
  let driver: CommunicatorDriverContract;

  switch (driverType) {
    case "rabbitmq": {
      const rabbitOptions = options as RabbitMQConnectionOptions;
      // Dynamic import to avoid requiring amqplib if not used
      const { RabbitMQDriver } = await import("../drivers/rabbitmq/rabbitmq-driver");
      driver = new RabbitMQDriver(rabbitOptions);
      break;
    }

    case "kafka": {
      // const kafkaOptions = options as KafkaConnectionOptions;
      // Dynamic import to avoid requiring kafkajs if not used
      throw new Error(
        "Kafka driver is not yet implemented. Coming soon! For now, please use RabbitMQ.",
      );
    }

    default:
      throw new Error(`Unknown driver: "${driverType}". Supported drivers: rabbitmq, kafka`);
  }

  // Create communicator
  const communicator = communicatorRegistry.register({
    name: communicatorName,
    driver,
    isDefault,
  });

  // Connect to the message broker
  try {
    await driver.connect();
  } catch (error) {
    throw new Error(
      `Failed to connect to ${driverType}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return communicator;
}

/**
 * Get a communicator by name or the default one.
 *
 * This is the main entry point for using communicators in your application.
 *
 * @param name - Optional communicator name (uses default if not provided)
 * @returns Communicator instance
 * @throws MissingCommunicatorError if communicator not found
 *
 * @example
 * ```typescript
 * // Get default communicator
 * const channel = communicators().channel("user.created");
 * await channel.publish({ userId: 1 });
 *
 * // Get specific communicator
 * const analyticsChannel = communicators("analytics").channel("events");
 * await analyticsChannel.publish({ event: "page_view" });
 *
 * // Subscribe to messages
 * communicators()
 *   .channel<UserPayload>("user.created")
 *   .subscribe(async (message, ctx) => {
 *     console.log("User created:", message.payload);
 *     await ctx.ack();
 *   });
 * ```
 */
export function communicators(name?: string): Communicator {
  return communicatorRegistry.get(name);
}

/**
 * Get channel instance for the given name from default communicator
 * @param name - Channel name
 * @returns Channel instance
 * @throws MissingCommunicatorError if communicator not found
 *
 * @example
 * ```typescript
 * const channel = communicatorChannel("user.created");
 * await channel.publish({ userId: 1 });
 * ```
 */
export function communicatorChannel<TPayload = unknown>(name: string, options?: ChannelOptions<TPayload>): ChannelContract<TPayload> {
  return communicators().channel<TPayload>(name, options);
}
