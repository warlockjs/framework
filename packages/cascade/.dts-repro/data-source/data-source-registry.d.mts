import { DataSource, DataSourceOptions } from "./data-source.mjs";

//#region ../../@warlock.js/cascade/src/data-source/data-source-registry.d.ts
/**
 * Event types emitted by the DataSourceRegistry.
 *
 * - `registered`: Emitted when any data source is registered
 * - `default-registered`: Emitted when a default data source is registered
 * - `connected`: Emitted when a data source's driver connects
 * - `disconnected`: Emitted when a data source's driver disconnects
 */
type DataSourceRegistryEvent = "registered" | "default-registered" | "connected" | "disconnected";
/**
 * Callback signature for registry events.
 */
type DataSourceRegistryListener = (dataSource: DataSource) => void;
/** Maintains registry of named data sources. */
declare class DataSourceRegistry {
  private readonly sources;
  private defaultSource?;
  private readonly events;
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
   * @param options - Data source configuration
   * @returns The registered data source instance
   */
  register(options: DataSourceOptions): DataSource;
  /**
   * Clean up all data sources and default one
   */
  clear(): void;
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
  on(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void;
  /**
   * Listen for a data source registration event once.
   *
   * The listener is automatically removed after being called once.
   *
   * @param event - The event to listen for
   * @param listener - Callback to execute when event fires
   */
  once(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void;
  /**
   * Remove a listener for a data source registration event.
   *
   * @param event - The event to stop listening for
   * @param listener - The listener to remove
   */
  off(event: DataSourceRegistryEvent, listener: DataSourceRegistryListener): void;
  /** Retrieve a data source either by name or the default one. */
  get(name?: string): DataSource;
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
  getAllDataSources(): DataSource[];
}
declare const dataSourceRegistry: DataSourceRegistry;
//#endregion
export { DataSourceRegistryEvent, DataSourceRegistryListener, dataSourceRegistry };
//# sourceMappingURL=data-source-registry.d.mts.map