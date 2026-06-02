import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
//#region ../../@warlock.js/core/src/storage/config.ts
function storageConfig(key, defaultValue) {
	if (!key) return config.get("storage");
	return config.get(`storage.${key}`, defaultValue);
}
const storageConfigurations = {
	local: (options) => {
		return {
			driver: "local",
			...options
		};
	},
	aws: (options) => {
		return {
			driver: "s3",
			...options
		};
	},
	r2: (options) => {
		return {
			driver: "r2",
			...options
		};
	},
	spaces: (options) => {
		return {
			driver: "spaces",
			...options
		};
	}
};
//#endregion
export { storageConfig, storageConfigurations };

//# sourceMappingURL=config.mjs.map