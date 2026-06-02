import { defaultWarlockConfigurations } from "./default-configurations.mjs";
import { merge } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/warlock-config/define-config.ts
function defineConfig(options) {
	return merge(defaultWarlockConfigurations, options);
}
//#endregion
export { defineConfig };

//# sourceMappingURL=define-config.mjs.map