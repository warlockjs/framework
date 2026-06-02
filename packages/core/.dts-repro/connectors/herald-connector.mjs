import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/connectors/herald-connector.ts
/**
* Herald Connector
* Manages message broker connection lifecycle using @warlock.js/herald
*/
var HeraldConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "herald";
		this.priority = 3;
		this.lifecyclePhase = "early";
		this.watchedFiles = ["src/config/herald.ts"];
	}
	/**
	* Initialize broker connection
	*/
	async start() {
		const heraldConfig = baseConfig.get("herald");
		if (!heraldConfig) return;
		try {
			const { connectToBroker } = await import("@warlock.js/herald");
			log.info(`herald.${heraldConfig.driver}`, "connection", "Connecting to message broker");
			await connectToBroker(heraldConfig);
			log.success(`herald.${heraldConfig.driver}`, "connection", "Connected to message broker");
			this.active = true;
		} catch (error) {
			log.error(`herald.${heraldConfig.driver}`, "connection", "Failed to connect to message broker");
			throw error;
		}
	}
	/**
	* Shutdown broker connection
	*/
	async shutdown() {
		if (!this.active) return;
		try {
			const { brokerRegistry } = await import("@warlock.js/herald");
			const brokers = brokerRegistry.getAll();
			for (const broker of brokers) if (broker.driver.isConnected) await broker.driver.disconnect();
			brokerRegistry.clear();
			this.active = false;
		} catch (error) {
			log.error("herald", "shutdown", "Failed to disconnect from message broker");
			throw error;
		}
	}
};
//#endregion
export { HeraldConnector };

//# sourceMappingURL=herald-connector.mjs.map