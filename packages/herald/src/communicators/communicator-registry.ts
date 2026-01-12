import { EventEmitter } from "node:events";
import type { CommunicatorRegistryEvent, CommunicatorRegistryListener } from "../types";
import { Communicator, type CommunicatorOptions } from "./communicator";

/**
 * Error thrown when a communicator is not found
 */
export class MissingCommunicatorError extends Error {
  public readonly communicatorName?: string;

  public constructor(message: string, communicatorName?: string) {
    super(message);
    this.name = "MissingCommunicatorError";
    this.communicatorName = communicatorName;
  }
}

/**
 * Communicator Registry
 *
 * Maintains registry of named communicators.
 * Similar to DataSourceRegistry in @warlock.js/cascade
 *
 * @example
 * ```typescript
 * // Register a communicator
 * communicatorRegistry.register({
 *   name: "default",
 *   driver: rabbitMQDriver,
 *   isDefault: true,
 * });
 *
 * // Get the default communicator
 * const comm = communicatorRegistry.get();
 *
 * // Get a specific communicator by name
 * const analytics = communicatorRegistry.get("analytics");
 *
 * // Listen for events
 * communicatorRegistry.on("connected", (comm) => {
 *   console.log(`${comm.name} connected`);
 * });
 * ```
 */
class CommunicatorRegistry {
  private readonly sources = new Map<string, Communicator>();
  private defaultSource?: Communicator;
  private readonly events = new EventEmitter();

  /**
   * Register a new communicator
   *
   * Sets up event forwarding from the driver to the registry.
   *
   * @param options - Communicator configuration
   * @returns The registered communicator instance
   *
   * @example
   * ```typescript
   * const communicator = communicatorRegistry.register({
   *   name: "primary",
   *   driver: myDriver,
   *   isDefault: true,
   * });
   * ```
   */
  public register(options: CommunicatorOptions): Communicator {
    const communicator = new Communicator(options);
    this.sources.set(communicator.name, communicator);

    const isNewDefault = communicator.isDefault || !this.defaultSource;

    if (isNewDefault) {
      this.defaultSource = communicator;
    }

    // Emit registration events
    this.events.emit("registered", communicator);

    if (isNewDefault) {
      this.events.emit("default-registered", communicator);
    }

    // Forward driver events to registry
    communicator.driver.on("connected", () => {
      this.events.emit("connected", communicator);
    });

    communicator.driver.on("disconnected", () => {
      this.events.emit("disconnected", communicator);
    });

    return communicator;
  }

  /**
   * Clear all registered communicators
   */
  public clear(): void {
    this.defaultSource = undefined;
    this.sources.clear();
  }

  /**
   * Listen for registry events
   *
   * @param event - Event to listen for
   * @param listener - Callback function
   *
   * @example
   * ```typescript
   * communicatorRegistry.on("registered", (comm) => {
   *   console.log(`Communicator "${comm.name}" registered`);
   * });
   *
   * communicatorRegistry.on("connected", (comm) => {
   *   console.log(`Communicator "${comm.name}" connected`);
   * });
   * ```
   */
  public on(event: CommunicatorRegistryEvent, listener: CommunicatorRegistryListener): void {
    this.events.on(event, listener as any);
  }

  /**
   * Listen for a registry event once
   *
   * @param event - Event to listen for
   * @param listener - Callback function
   */
  public once(event: CommunicatorRegistryEvent, listener: CommunicatorRegistryListener): void {
    this.events.once(event, listener as any);
  }

  /**
   * Remove an event listener
   *
   * @param event - Event to stop listening for
   * @param listener - Callback to remove
   */
  public off(event: CommunicatorRegistryEvent, listener: CommunicatorRegistryListener): void {
    this.events.off(event, listener as any);
  }

  /**
   * Get a communicator by name or the default one
   *
   * @param name - Optional communicator name
   * @returns Communicator instance
   * @throws MissingCommunicatorError if not found
   *
   * @example
   * ```typescript
   * // Get default communicator
   * const comm = communicatorRegistry.get();
   *
   * // Get specific communicator
   * const analytics = communicatorRegistry.get("analytics");
   * ```
   */
  public get(name?: string): Communicator {
    if (name !== undefined) {
      const source = this.sources.get(name);
      if (!source) {
        throw new MissingCommunicatorError(`Communicator "${name}" is not registered.`, name);
      }
      return source;
    }

    if (!this.defaultSource) {
      throw new MissingCommunicatorError("No default communicator registered.");
    }

    return this.defaultSource;
  }

  /**
   * Check if a communicator exists
   *
   * @param name - Communicator name to check
   * @returns True if exists
   */
  public has(name: string): boolean {
    return this.sources.has(name);
  }

  /**
   * Check if any communicators are registered
   */
  public hasAny(): boolean {
    return this.sources.size > 0;
  }

  /**
   * Get all registered communicators
   *
   * @returns Array of all communicators
   *
   * @example
   * ```typescript
   * // Disconnect all communicators
   * for (const comm of communicatorRegistry.getAll()) {
   *   await comm.disconnect();
   * }
   * ```
   */
  public getAll(): Communicator[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get all communicator names
   *
   * @returns Array of communicator names
   */
  public getNames(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * Get the default communicator (if any)
   *
   * @returns Default communicator or undefined
   */
  public getDefault(): Communicator | undefined {
    return this.defaultSource;
  }
}

/**
 * Global communicator registry instance
 */
export const communicatorRegistry = new CommunicatorRegistry();
