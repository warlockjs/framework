import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { defaultWarlockConfigurations } from "../warlock-config/default-configurations.mjs";
import path from "path";
//#region ../../@warlock.js/core/src/production/resolve-build-config.ts
/**
* Resolve the build config with framework defaults applied.
*
* Both the production builder and `warlock start` call this so they
* agree on where the bundle lives — previously each had its own local
* fallbacks and they drifted (`.warlock/production` vs `dist`),
* letting `build` and `start` look at different paths.
*/
function resolveBuildConfig() {
	const userBuild = warlockConfigManager.get("build") ?? {};
	const merged = {
		...defaultWarlockConfigurations.build,
		...userBuild
	};
	return {
		...merged,
		entryPath: path.resolve(merged.outDirectory, merged.outFile)
	};
}
//#endregion
export { resolveBuildConfig };

//# sourceMappingURL=resolve-build-config.mjs.map