import baseConfig from "@mongez/config";
//#region ../../@warlock.js/core/src/config/config-getter.ts
/**
* Config accessor with typed autocomplete and return type inference.
*
* @example
* ```typescript
* // Get entire config group - returns the actual config type
* const db = config.get("database"); // → DatabaseConfigurations
*
* // Get specific key with dot notation
* const host = config.key("database.host");
* const port = config.key<number>("database.port", 27017);
* ```
*/
const config = {
	key(key, defaultValue) {
		return baseConfig.get(key, defaultValue);
	},
	get(name, defaultValue) {
		return baseConfig.get(name, defaultValue);
	}
};
//#endregion
export { config };

//# sourceMappingURL=config-getter.mjs.map