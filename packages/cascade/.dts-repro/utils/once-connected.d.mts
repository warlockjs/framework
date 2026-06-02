import { DataSource } from "../data-source/data-source.mjs";

//#region ../../@warlock.js/cascade/src/utils/once-connected.d.ts
/**
 * Execute a callback once the driver is connected.
 *
 * If the driver is already connected, the callback is executed immediately.
 * Otherwise, it waits for the "connected" event.
 *
 * **Use Case:**
 * Useful for ensuring database-dependent operations only run after connection
 * is established, especially in small to medium projects with a single data source.
 *
 * @param dataSourceOrNameOrCallback - Data source instance, name, or callback function
 * @param callback - Function to execute once connected (optional if first param is callback)
 *
 * @example
 * ```typescript
 * // With default data source (just callback)
 * await connectToDatabase({ database: "myapp" });
 *
 * onceConnected((ds) => {
 *   console.log("Database is ready!");
 *   console.log("Connected to:", ds.name);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With data source name
 * onceConnected("primary", (ds) => {
 *   console.log("Primary database is ready!");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With data source instance
 * const dataSource = await connectToDatabase({ database: "myapp" });
 *
 * onceConnected(dataSource, (ds) => {
 *   console.log("Database is ready!");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With driver instance
 * const driver = new MongoDbDriver(config);
 * const dataSource = new DataSource({ name: "primary", driver });
 *
 * onceConnected(dataSource, () => {
 *   // Start application server
 *   app.listen(3000);
 * });
 *
 * // Connect after setting up the callback
 * await driver.connect();
 * ```
 *
 * @example
 * ```typescript
 * // Chaining operations
 * onceConnected(async (ds) => {
 *   // Seed database
 *   await seedDatabase();
 *
 *   // Run migrations
 *   await runMigrations();
 *
 *   console.log("Database ready!");
 * });
 * ```
 */
declare function onceConnected(dataSourceOrNameOrCallback: DataSource | string | ((dataSource: DataSource) => void), callback?: (dataSource: DataSource) => void): void;
/**
 * Execute a callback once the driver is disconnected.
 *
 * If the driver is already disconnected, the callback is executed immediately.
 * Otherwise, it waits for the "disconnected" event.
 *
 * **Use Case:**
 * Useful for cleanup operations, graceful shutdown, or reconnection logic.
 *
 * @param dataSourceOrNameOrCallback - Data source instance, name, or callback function
 * @param callback - Function to execute once disconnected (optional if first param is callback)
 *
 * @example
 * ```typescript
 * // With default data source (just callback)
 * await connectToDatabase({ database: "myapp" });
 *
 * onceDisconnected((ds) => {
 *   console.log("Database disconnected!");
 *   console.log("Attempting reconnection...");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With data source name
 * onceDisconnected("primary", (ds) => {
 *   console.log("Primary database disconnected!");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With data source instance
 * const dataSource = await connectToDatabase({ database: "myapp" });
 *
 * onceDisconnected(dataSource, (ds) => {
 *   console.log("Database disconnected!");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Graceful shutdown with default data source
 * process.on("SIGTERM", async () => {
 *   console.log("Shutting down...");
 *
 *   onceDisconnected(() => {
 *     console.log("Database closed, exiting process");
 *     process.exit(0);
 *   });
 *
 *   const dataSource = DataSourceRegistry.getDefault();
 *   await dataSource?.driver.disconnect();
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Cleanup resources on disconnect
 * onceDisconnected(async (ds) => {
 *   // Close file handles
 *   await closeFileHandles();
 *
 *   // Clear caches
 *   clearCaches();
 *
 *   console.log("Cleanup complete");
 * });
 * ```
 */
declare function onceDisconnected(dataSourceOrNameOrCallback: DataSource | string | ((dataSource: DataSource) => void), callback?: (dataSource: DataSource) => void): void;
//#endregion
export { onceConnected, onceDisconnected };
//# sourceMappingURL=once-connected.d.mts.map