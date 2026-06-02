import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
//#region ../../@warlock.js/core/src/http/uploads-config.ts
/**
* Default uploads configuration values
*
* These defaults are used when no configuration is provided
* or when specific keys are missing from the app config.
*/
const UPLOADS_DEFAULTS = {
	name: "random",
	randomLength: 32,
	prefix: {
		as: "directory",
		format: "DD-MM-YYYY"
	}
};
/**
* Get uploads configuration value
*
* Retrieves a configuration value from the `uploads` section of app config,
* falling back to the provided default or the built-in default.
*
* @param key - Configuration key to retrieve
* @param defaultValue - Optional default value if not found
* @returns The configuration value
*
* @example
* ```typescript
* const naming = uploadsConfig("name"); // "random" or "original"
* const length = uploadsConfig("randomLength", 32);
* ```
*/
function uploadsConfig(key, defaultValue) {
	const fallback = defaultValue ?? UPLOADS_DEFAULTS[key];
	return config.key(`uploads.${key}`, fallback);
}
//#endregion
export { UPLOADS_DEFAULTS, uploadsConfig };

//# sourceMappingURL=uploads-config.mjs.map