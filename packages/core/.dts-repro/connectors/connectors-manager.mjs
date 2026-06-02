import { CacheConnector } from "./cache-connector.mjs";
import { HeraldConnector } from "./herald-connector.mjs";
import { devServeLog } from "../dev-server/dev-logger.mjs";
import { DatabaseConnector } from "./database-connector.mjs";
import { HttpConnector } from "./http-connector.mjs";
import { LoggerConnector } from "./logger-connector.mjs";
import { MailerConnector } from "./mail-connector.mjs";
import { SocketConnector } from "./socket-connector.mjs";
import { StorageConnector } from "./storage.connector.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/connectors/connectors-manager.ts
var ConnectorsManager = class {
	/**
	* Constructor
	*/
	constructor() {
		this.connectors = [];
		this.register(new LoggerConnector());
		this.register(new MailerConnector());
		this.register(new HttpConnector());
		this.register(new DatabaseConnector());
		this.register(new HeraldConnector());
		this.register(new CacheConnector());
		this.register(new StorageConnector());
		this.register(new SocketConnector());
	}
	/**
	* Register a connector
	*/
	register(...connectors) {
		this.connectors.push(...connectors);
		this.connectors.sort((a, b) => a.priority - b.priority);
	}
	/**
	* Get all connectors
	*/
	list() {
		return this.connectors;
	}
	/**
	* start all connectors
	*/
	async start(connectorsNames) {
		const connectorsList = connectorsNames ? this.connectors.filter((connector) => connectorsNames.includes(connector.name)) : this.connectors;
		for (const connector of connectorsList) await connector.boot();
		for (const connector of connectorsList) await connector.start();
	}
	/**
	* Start all connectors in the given lifecycle phase.
	*
	* The production builder and dev preload split startup around app
	* code: early phase before app imports, late phase after. Within a
	* phase, all connectors `boot()` first, then all `start()`, so
	* cross-connector wiring inside the phase still works (e.g. socket
	* reads http's instance during its own boot).
	*/
	async startPhase(phase) {
		const phaseConnectors = this.connectors.filter((connector) => connector.lifecyclePhase === phase);
		for (const connector of phaseConnectors) await connector.boot();
		for (const connector of phaseConnectors) await connector.start();
	}
	/**
	* Start all connectors except the given ones
	*/
	async startWithout(excludedConnectors) {
		await this.start(this.connectors.filter((connector) => !excludedConnectors.includes(connector.name)).map((connector) => connector.name));
	}
	/**
	* Shutdown all connectors
	*/
	async shutdown() {
		for (const connector of this.connectors.reverse()) try {
			await connector.shutdown();
		} catch (error) {
			devServeLog(colors.redBright(`❌ Failed to shutdown ${connector.name}: ${error}`));
		}
	}
	/**
	* Shutdown connectors on process kill
	*
	* Handles graceful shutdown for both Unix and Windows:
	* - SIGINT: Ctrl+C on Unix, also caught on Windows but unreliable in child processes
	* - SIGTERM: Termination signal (Unix primarily)
	* - beforeExit: Fires when Node.js empties its event loop (more reliable on Windows)
	*/
	shutdownOnProcessKill() {
		let isShuttingDown = false;
		const gracefulShutdown = async (signal) => {
			if (isShuttingDown) return;
			isShuttingDown = true;
			console.log(`\nExiting...`);
			await this.shutdown();
			process.exit(0);
		};
		process.on("SIGINT", () => gracefulShutdown("SIGINT"));
		process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
		if (process.platform === "win32") process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
	}
};
const connectorsManager = new ConnectorsManager();
//#endregion
export { ConnectorsManager, connectorsManager };

//# sourceMappingURL=connectors-manager.mjs.map