import { rootPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { devLogWarn } from "../dev-server/dev-logger.mjs";
import { get } from "@mongez/reinforcements";
import { fileExistsAsync } from "@warlock.js/fs";
import { pathToFileURL } from "url";
//#region ../../@warlock.js/core/src/warlock-config/warlock-config.manager.ts
/**
* Warlock Config Manager
*
* Manages lazy loading of the pre-compiled warlock.config.js file
* from the .warlock/cache directory.
*/
var WarlockConfigManager = class {
	/**
	* Load warlock.config.js (cached after first load)
	*
	* @returns The resolved Warlock configuration
	*/
	async load() {
		if (this.config) return this.config;
		if (this.loading) return this.loading;
		this.loading = this.doLoad();
		this.config = await this.loading;
		this.loading = void 0;
		return this.config;
	}
	/**
	* Internal load implementation
	*
	* The ESM loader hook transpiles `warlock.config.ts` on import â€” no
	* separate compile-to-disk step is needed.
	*/
	async doLoad() {
		const configPath = rootPath("warlock.config.ts");
		if (!await fileExistsAsync(configPath)) {
			devLogWarn("warlock.config.ts is missing, it's highly recommended to create it, run warlock init to create it");
			return;
		}
		try {
			return (await import(pathToFileURL(configPath).href)).default;
		} catch (error) {
			throw new Error(`Failed to load warlock.config.ts: ${error}`);
		}
	}
	/**
	* Get config value by key (dot notation supported)
	*
	* @example
	* config.get("server.port") // Returns 3000
	* config.get("cli.commands") // Returns array of commands
	*
	* @param key - Config key (supports dot notation), autocompletes for first level only
	* @returns The config value
	* @throws Error if config is not loaded
	*/
	get(key, defaultValue) {
		if (!this.config) throw new Error("WarlockConfig not loaded. Call load() first or use lazyGet().");
		return get(this.config, key, defaultValue);
	}
	/**
	* Lazy get - loads config if not already loaded
	*
	* @example
	* const port = await config.lazyGet("server");
	*
	* @param key - Config key (supports dot notation), autocompletes for first level only
	* @param defaultValue - Default value if config key is undefined
	* @returns The config value
	*/
	async lazyGet(key, defaultValue) {
		await this.load();
		return this.get(key, defaultValue);
	}
	/**
	* Check if config is loaded
	*/
	get isLoaded() {
		return this.config !== void 0;
	}
	/**
	* Get the entire config object
	*
	* @throws Error if config is not loaded
	*/
	getAll() {
		if (!this.config) throw new Error("WarlockConfig not loaded. Call load() first or use lazyGet().");
		return this.config;
	}
	/**
	* Reload config (useful for HMR/development)
	*/
	async reload() {
		this.config = void 0;
		this.loading = void 0;
		await this.load();
	}
};
/**
* Exported singleton instance
*
* @example
* import { warlockConfig } from "@warlock.js/core";
*
* // Lazy load and get value
* const port = await warlockConfig.lazyGet("server.port");
*
* // Or load first, then get
* await warlockConfig.load();
* const commands = warlockConfig.get("cli.commands");
*/
const warlockConfigManager = new WarlockConfigManager();
//#endregion
export { WarlockConfigManager, warlockConfigManager };

//# sourceMappingURL=warlock-config.manager.mjs.map