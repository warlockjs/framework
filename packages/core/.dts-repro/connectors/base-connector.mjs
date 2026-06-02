import { Path } from "../dev-server/path.mjs";
import "./types.mjs";
//#region ../../@warlock.js/core/src/connectors/base-connector.ts
/**
* Base Connector Class
* Provides common functionality for all connectors
*/
var BaseConnector = class {
	constructor() {
		this.lifecyclePhase = "early";
		this.active = false;
	}
	/**
	* Check if connector is active
	*/
	isActive() {
		return this.active;
	}
	/**
	* Boot the connector
	*/
	async boot() {}
	/**
	* Restart the connector
	*/
	async restart() {
		await this.shutdown();
		await this.start();
	}
	/**
	* Determine if connector should restart based on changed files
	*/
	shouldRestart(changedFiles) {
		return changedFiles.some((file) => this.isWatchedFile(file));
	}
	/**
	* Check if a file is watched by this connector
	*/
	isWatchedFile(file) {
		const relativePath = Path.toRelative(file);
		return this.watchedFiles.some((watchedFile) => {
			if (watchedFile === relativePath) return true;
			if (watchedFile.includes("*")) return new RegExp("^" + watchedFile.replace(/\*/g, ".*") + "$").test(relativePath);
			return false;
		});
	}
};
//#endregion
export { BaseConnector };

//# sourceMappingURL=base-connector.mjs.map