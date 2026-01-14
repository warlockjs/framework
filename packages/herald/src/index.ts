/**
 * Warlock Herald - Message Bus / Communicators
 *
 * A powerful, type-safe message bus library for RabbitMQ, Kafka, and more.
 *
 * Package: @warlock.js/herald
 *
 * Let heralds carry your messages across services!
 *
 * Structure:
 * - contracts/ - Core interfaces
 * - communicators/ - Communicator and registry
 * - drivers/ - RabbitMQ, Kafka implementations
 * - types/ - TypeScript type definitions
 * - utils/ - Connection helpers
 *
 * @example
 * ```typescript
 * import { connectToCommunicator, communicators } from "@warlock.js/herald";
 *
 * // Connect to RabbitMQ
 * await connectToCommunicator({
 *   driver: "rabbitmq",
 *   host: "localhost",
 *   port: 5672,
 * });
 *
 * // Publish a message
 * await communicators().channel("user.created").publish({ userId: 1 });
 *
 * // Subscribe to messages
 * communicators()
 *   .channel<UserPayload>("user.created")
 *   .subscribe(async (message, ctx) => {
 *     console.log(message.payload);
 *     await ctx.ack();
 *   });
 * ```
 */

// Export types
export * from "./types";

// Export contracts
export * from "./contracts";

// Export communicators
export * from "./communicators";

// Export drivers
export * from "./drivers";

// Export utilities (connectToCommunicator, communicators function)
export * from "./utils";

// Export message managers
export * from "./message-managers";

// Export decorators
export * from "./decorators";
