import { StorageDriverContract } from "../types.mjs";
import { Context } from "@warlock.js/context";

//#region ../../@warlock.js/core/src/storage/context/storage-driver-context.d.ts
type StorageDriverContextStore = {
  driver?: StorageDriverContract;
  prefix?: string;
  metadata?: Record<string, any>;
};
/**
 * Storage Driver Context
 *
 * Manages the active storage driver and path prefix using AsyncLocalStorage.
 * Allows multi-tenant applications to switch drivers and isolate storage paths per request context.
 *
 * @example
 * ```typescript
 * // Set driver with tenant-specific prefix
 * storageDriverContext.setDriver(storage.getDriver("s3"), {
 *   prefix: "tenant-123",
 *   metadata: { tenantId: "123" }
 * });
 *
 * // Or just set prefix for same driver
 * storageDriverContext.setPrefix("tenant-456");
 * ```
 */
declare class StorageDriverContext extends Context<StorageDriverContextStore> {
  /**
   * Get the current storage driver
   */
  getDriver(): StorageDriverContract | undefined;
  /**
   * Get the current path prefix (e.g., tenant-specific path)
   */
  getPrefix(): string | undefined;
  /**
   * Get context metadata (e.g., tenantId)
   */
  getMetadata(): Record<string, any> | undefined;
  /**
   * Set the active driver with optional prefix and metadata
   *
   * @param driver - Storage driver to use
   * @param options - Optional prefix and metadata
   */
  setDriver(driver: StorageDriverContract, options?: {
    prefix?: string;
    metadata?: Record<string, any>;
  }): void;
  /**
   * Set only the path prefix (keeps current driver)
   *
   * Useful for multi-tenant scenarios where you want to isolate
   * storage paths without changing the driver.
   *
   * @param prefix - Path prefix to prepend to all operations
   */
  setPrefix(prefix: string): void;
  /**
   * Clear the prefix
   */
  clearPrefix(): void;
  /**
   * Build the initial storage store with defaults
   */
  buildStore(): StorageDriverContextStore;
}
declare const storageDriverContext: StorageDriverContext;
//#endregion
export { StorageDriverContextStore, storageDriverContext };
//# sourceMappingURL=storage-driver-context.d.mts.map