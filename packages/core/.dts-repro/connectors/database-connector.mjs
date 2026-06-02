import { container } from "../container/index.mjs";
import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import baseConfig from "@mongez/config";
import { connectToDatabase, dataSourceRegistry } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/connectors/database-connector.ts
/**
* Database Connector
* Manages database connection lifecycle using @warlock.js/cascade
*/
var DatabaseConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "database";
		this.priority = 2;
		this.lifecyclePhase = "early";
		this.watchedFiles = ["src/config/database.ts", "src/config/database.tsx"];
	}
	/**
	* Initialize database connection
	*/
	async start() {
		const databaseConfig = baseConfig.get("database");
		if (!databaseConfig) return;
		try {
			const source = await connectToDatabase(databaseConfig);
			container.set("database.source", source);
			this.active = true;
		} catch (error) {
			console.error("Failed to connect to database:", error);
			throw error;
		}
	}
	/**
	* Shutdown database connection
	*/
	async shutdown() {
		if (!this.active) return;
		try {
			const dataSources = dataSourceRegistry.getAllDataSources();
			for (const dataSource of dataSources) if (dataSource.driver.isConnected) await dataSource.driver.disconnect();
			this.active = false;
		} catch (error) {
			console.error("Failed to disconnect from database:", error);
			throw error;
		}
	}
};
//#endregion
export { DatabaseConnector };

//# sourceMappingURL=database-connector.mjs.map