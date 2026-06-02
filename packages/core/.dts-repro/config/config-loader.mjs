import { configSpecialHandlers } from "./config-special-handlers.mjs";
import baseConfig from "@mongez/config";
import { colors } from "@mongez/copper";
import { pathToFileURL } from "node:url";
//#region ../../@warlock.js/core/src/config/config-loader.ts
/**
* Config Loader
* Dynamically loads all configuration files and registers them with @mongez/config
* Supports special handlers for configs that require additional processing
*/
var ConfigLoader = class {
	async loadAll(configFiles) {
		for (const file of configFiles) await this.loadConfig(file);
	}
	/**
	* Load a single configuration file.
	*
	* The ESM loader hook stamps a version token onto the URL so that each HMR
	* cycle gets a fresh module — no manual cache-busting needed here.
	*/
	async loadConfig(file) {
		const configName = this.getConfigName(file.relativePath);
		try {
			const configValue = (await import(pathToFileURL(file.absolutePath).href)).default;
			if (configValue === void 0) {
				console.log(colors.red(`config error: `), `Config file ${colors.yellow(file.relativePath)} does not have a default export`);
				return;
			}
			baseConfig.set(configName, configValue);
			await configSpecialHandlers.execute(configName, configValue);
		} catch (error) {
			throw error;
		}
	}
	async reloadConfig(file) {
		await this.loadConfig(file);
	}
	getConfigName(relativePath) {
		const match = relativePath.match(/^src\/config\/(.+)\.(ts|tsx)$/);
		if (!match) throw new Error(`Invalid config file path: ${relativePath}`);
		return match[1];
	}
};
//#endregion
export { ConfigLoader };

//# sourceMappingURL=config-loader.mjs.map