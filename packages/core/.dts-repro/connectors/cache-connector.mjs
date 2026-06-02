import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import baseConfig from "@mongez/config";
import { cache } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/connectors/cache-connector.ts
/**
* Cache Connector
* Manages cache engine connection lifecycle
*/
var CacheConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "cache";
		this.priority = 4;
		this.lifecyclePhase = "early";
		this.watchedFiles = ["src/config/cache.ts", "src/config/cache.tsx"];
	}
	/**
	* Initialize cache connection
	*/
	async start() {
		const cacheConfig = baseConfig.get("cache");
		if (!cacheConfig) return;
		cache.setCacheConfigurations(cacheConfig);
		await cache.init();
		this.active = true;
	}
	/**
	* Shutdown cache connection
	*/
	async shutdown() {
		if (!this.active) return;
		this.active = false;
	}
};
//#endregion
export { CacheConnector };

//# sourceMappingURL=cache-connector.mjs.map