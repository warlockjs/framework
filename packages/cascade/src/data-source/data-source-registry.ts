import { EventEmitter } from "node:events";
import { databaseDataSourceContext } from "../context/database-data-source-context";
import { MissingDataSourceError } from "../errors/missing-data-source.error";
import { DataSource, type DataSourceOptions } from "./data-source";

/**
 * Event types emitted by the DataSourceRegistry.
 *
 * - `registered`: Emitted when any data source is registered
 * - `default-registered`: Emitted when a default data source is registered
 * - `connected`: Emitted when a data source's driver connects
 * - `disconnected`: Emitted when a data source's driver disconnects
 */
export type DataSourceRegistryEvent =
  | "registered"
  | "default-registered"
  | "connected"
  | "disconnected";

/**
 * Callback signature for registry events.
 */
export type DataSourceRegistryListener = (dataSource: DataSource) => void;

/** Maintains registry of named data sources. */
class DataSourceRegistry {
  private readonly sources = new Map<string, DataSource>();
  private defaultSource?: DataSource;
  private defaultIsExplicit = false;
  private readonly events = new EventEmitter();
  /** Replaced sources; their forwarded driver events are ignored (drivers have no `off`). */
  private readonly detached = new WeakSet<DataSource>();
  /** In-flight `getOrRegister` factories, so concurrent callers share one creation. */
  private readonly pending = new Map<string, Promise<DataSource>>();

  /**
   * Register a new data source definition.
   *
   * Sets up event forwarding from the driver to the registry, allowing
   * centralized listening for connection state changes.
   *
   * **Emits:**
   * - `registered` - When the data source is registered
   * - `default-registered` - If this becomes the default data source
   * - `connected` - When the driver connects (forwarded from driver)
   * - `disconnected` - When the driver disconnects (forwarded from driver)
   *
   * The first registered source becomes the default. Later sources become the default
   * only when they explicitly claim it, and two explicit claims throw.
   *
   * @param options - Data source configuration
   * @param meta - `explicitDefault` tells whether the caller explicitly requested `isDefault: true`
   *  (defaults to `options.isDefault`), as opposed to it being implied by being the first source.
   *  `replace: true` also disconnects the previously registered source of the same name (in the
   *  background). Either way the old source's events stop being forwarded and, if it was the
   *  default, the new source takes its place.
   * @returns The registered data source instance
   */
  public register(
    options: DataSourceOptions,
    meta?: { explicitDefault?: boolean; replace?: boolean },
  ): DataSource {
    const source = new DataSource(options);
    const explicitDefault = meta?.explicitDefault ?? source.isDefault;

    if (
      explicitDefault &&
      this.defaultIsExplicit &&
      this.defaultSource &&
      this.defaultSource.name !== source.name
    ) {
      throw new Error(
        `Data source "${source.name}" cannot be the default: "${this.defaultSource.name}" is already the default data source.`,
      );
    }

    const previous = this.sources.get(source.name);

    this.sources.set(source.name, source);

    if (previous) {
      this.detached.add(previous);

      if (meta?.replace) {
        previous.driver.disconnect().catch(() => undefined);
      }
    }

    // A replaced default hands the default over to its replacement, otherwise get()
    // would keep returning the stale source.
    const replacesDefault = previous !== undefined && previous === this.defaultSource;
    const isNewDefault = explicitDefault || !this.defaultSource || replacesDefault;

    if (isNewDefault) {
      this.defaultSource = source;
      this.defaultIsExplicit = replacesDefault
        ? this.defaultIsExplicit || explicitDefault
        : explicitDefault;
    }

    // Emit registration events
    this.events.emit("registered", source);

    if (isNewDefault) {
      this.events.emit("default-registered", source);
    }

    source.driver.on("connected", () => {
      if (!this.detached.has(source)) this.events.emit("connected", source);
    });

    source.driver.on("disconnected", () => {
      if (!this.detached.has(source)) this.events.emit("disconnected", source);
    });

    return source;
  }

  /**
   * Remove a registered source (only if it is still the one registered under its name).
   * If it was the default, the registry has no default until another source claims it.
   */
  public unregister(source: DataSource): void {
    if (this.sources.get(source.name) !== source) return;

    this.sources.delete(source.name);
    this.detached.add(source);

    if (this.defaultSource === source) {
      this.defaultSource = undefined;
      this.defaultIsExplicit = false;
    }
  }

  /**
   * Return the registered source for `name`, or create and register it via `factory`.
   *
   * Concurrent callers for the same name share one in-flight factory call, so only one
   * driver/pool is created. A failed factory is not cached.
   */
  public getOrRegister(
    name: string,
    factory: () => DataSourceOptions | Promise<DataSourceOptions>,
  ): Promise<DataSource> {
    const existing = this.sources.get(name);

    if (existing) return Promise.resolve(existing);

    const inFlight = this.pending.get(name);

    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const options = await factory();

        return this.sources.get(name) ?? this.register({ ...options, name });
      } finally {
        this.pending.delete(name);
      }
    })();

    this.pending.set(name, promise);

    return promise;
  }

  /**
   * Determine whether a default data source is already registered.
   */
  public hasDefault(): boolean {
    return this.defaultSource !== undefined;
  }

  /**
   * Clean up all data sources and default one
   */
  public clear() {
    this.defaultSource = undefined;
    this.defaultIsExplicit = false;
    this.sources.clear();
    this.pending.clear();
  }

  /**
   * Listen for data source registry events.
   *
   * @param event - The event to listen for
   * @param listener - Callback to execute when event fires
   *
   * @example
   * ```typescript
   * // Listen for registration
   * dataSourceRegistry.on("registered", (ds) => {
   *   console.log(`Data source "${ds.name}" registered`);
   *   console.log(`Driver: ${ds.driver.name}`); // e.g., "mongodb"
   * });
   *
   * // Listen for default data source
   * dataSourceRegistry.on("default-registered", (ds) => {
   *   console.log(`Default data source set to "${ds.name}"`);
   * });
   *
   * // Listen for connection events (forwarded from drivers)
   * dataSourceRegistry.on("connected", (ds) => {
   *   console.log(`${ds.driver.name} data source "${ds.name}" connected`);
   * });
   *
   * dataSourceRegistry.on("disconnected", (ds) => {
   *   console.log(`${ds.driver.name} data source "${ds.name}" disconnected`);
   * });
   * ```
   */
  public on(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void {
    this.events.on(event, listener);
  }

  /**
   * Listen for a data source registration event once.
   *
   * The listener is automatically removed after being called once.
   *
   * @param event - The event to listen for
   * @param listener - Callback to execute when event fires
   */
  public once(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void {
    this.events.once(event, listener);
  }

  /**
   * Remove a listener for a data source registration event.
   *
   * @param event - The event to stop listening for
   * @param listener - The listener to remove
   */
  public off(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void {
    this.events.off(event, listener);
  }

  /** Retrieve a data source either by name or the default one. */
  public get(name?: string): DataSource {
    const contextSource = name == null ? databaseDataSourceContext.getDataSource() : null;

    if (contextSource) {
      if (contextSource instanceof DataSource) {
        return contextSource;
      }

      const override = this.sources.get(contextSource);

      if (!override) {
        throw new MissingDataSourceError(
          `Data source "${contextSource}" is not registered (context override).`,
          contextSource,
        );
      }

      return override;
    }

    if (name != null) {
      const source = this.sources.get(name);
      if (!source) {
        throw new MissingDataSourceError(`Data source "${name}" is not registered.`, name);
      }
      return source;
    }

    if (!this.defaultSource) {
      throw new MissingDataSourceError("No default data source registered.");
    }

    return this.defaultSource;
  }

  /**
   * Get all registered data sources.
   *
   * Useful for operations that need to iterate over all sources,
   * such as shutting down all connections.
   *
   * @returns Array of all registered data sources
   *
   * @example
   * ```typescript
   * // Shutdown all data sources
   * for (const dataSource of dataSourceRegistry.getAllDataSources()) {
   *   await dataSource.driver.disconnect();
   * }
   * ```
   */
  public getAllDataSources(): DataSource[] {
    return Array.from(this.sources.values());
  }
}

export const dataSourceRegistry = new DataSourceRegistry();
