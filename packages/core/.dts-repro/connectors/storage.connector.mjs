import { loadS3 } from "../storage/drivers/cloud-driver.mjs";
import { storage } from "../storage/storage.mjs";
import "../storage/index.mjs";
import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
//#region ../../@warlock.js/core/src/connectors/storage.connector.ts
/**
* Cache Connector
* Manages cache engine connection lifecycle
*/
var StorageConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "storage";
		this.priority = 6;
		this.lifecyclePhase = "early";
		this.watchedFiles = ["src/config/storage.ts", "src/config/storage.tsx"];
	}
	/**
	* Initialize cache connection
	*/
	async start() {
		await loadS3();
		await storage.init();
		this.active = true;
	}
	/**
	* Shutdown cache connection
	*/
	async shutdown() {
		if (!this.active) return;
		storage.reset();
		this.active = false;
	}
};
//#endregion
export { StorageConnector };

//# sourceMappingURL=storage.connector.mjs.map