import { ConfigLoader } from "./config-loader.mjs";
//#region ../../@warlock.js/core/src/config/config-manager.ts
var ConfigManager = class {
	/**
	* Constructor
	*/
	constructor() {
		this.loader = new ConfigLoader();
	}
	/**
	* Load all config files
	*/
	async loadAll(files) {
		return this.loader.loadAll(files);
	}
	/**
	* Reload a config file
	*/
	async reload(file) {
		return this.loader.reloadConfig(file);
	}
};
const configManager = new ConfigManager();
//#endregion
export { configManager };

//# sourceMappingURL=config-manager.mjs.map