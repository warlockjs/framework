import { Context, contextManager } from "@warlock.js/context";
//#region ../../@warlock.js/core/src/storage/context/storage-driver-context.ts
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
var StorageDriverContext = class extends Context {
	/**
	* Get the current storage driver
	*/
	getDriver() {
		return this.get("driver");
	}
	/**
	* Get the current path prefix (e.g., tenant-specific path)
	*/
	getPrefix() {
		return this.get("prefix");
	}
	/**
	* Get context metadata (e.g., tenantId)
	*/
	getMetadata() {
		return this.get("metadata");
	}
	/**
	* Set the active driver with optional prefix and metadata
	*
	* @param driver - Storage driver to use
	* @param options - Optional prefix and metadata
	*/
	setDriver(driver, options) {
		this.update({
			driver,
			prefix: options?.prefix,
			metadata: options?.metadata
		});
	}
	/**
	* Set only the path prefix (keeps current driver)
	*
	* Useful for multi-tenant scenarios where you want to isolate
	* storage paths without changing the driver.
	*
	* @param prefix - Path prefix to prepend to all operations
	*/
	setPrefix(prefix) {
		this.update({ prefix });
	}
	/**
	* Clear the prefix
	*/
	clearPrefix() {
		this.update({ prefix: void 0 });
	}
	/**
	* Build the initial storage store with defaults
	*/
	buildStore() {
		return {
			driver: void 0,
			prefix: void 0,
			metadata: void 0
		};
	}
};
const storageDriverContext = new StorageDriverContext();
contextManager.register("storage", storageDriverContext);
//#endregion
export { storageDriverContext };

//# sourceMappingURL=storage-driver-context.mjs.map