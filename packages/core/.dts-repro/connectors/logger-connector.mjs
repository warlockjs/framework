import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import { setLogConfigurations } from "../logger/logger.mjs";
import "../logger/index.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/connectors/logger-connector.ts
/**
* Logger Connector
* Manages logger lifecycle and ensures synchronous flushing on termination
*/
var LoggerConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "logger";
		this.priority = 0;
		this.lifecyclePhase = "early";
		this.watchedFiles = ["src/config/log.ts", "src/config/log.tsx"];
	}
	/**
	* Initialize logger configurations
	*/
	async start() {
		const logConfig = baseConfig.get("log");
		if (!logConfig) return;
		try {
			setLogConfigurations(logConfig);
			this.active = true;
		} catch (error) {
			console.error("Failed to initialize logger:", error);
			throw error;
		}
	}
	/**
	* Shutdown logger and flush messages synchronously
	*/
	async shutdown() {
		if (!this.active) return;
		try {
			log.flushSync();
			this.active = false;
		} catch (error) {
			console.error("Failed to flush logger:", error);
			throw error;
		}
	}
};
//#endregion
export { LoggerConnector };

//# sourceMappingURL=logger-connector.mjs.map