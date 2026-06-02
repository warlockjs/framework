import { getJsonFileAsync } from "@warlock.js/fs";
import path from "node:path";
//#region ../../@warlock.js/core/src/utils/framework-vesion.ts
/**
* Cached version string
*/
let cachedVersion = null;
/**
* Get the framework version from package.json (cached)
*/
async function getWarlockVersion() {
	if (cachedVersion) return cachedVersion;
	const version = (await getJsonFileAsync(path.join(import.meta.dirname, "./../../package.json"))).version.replace(/\^|\~/g, "");
	cachedVersion = version;
	return version;
}
function getFrameworkVersion() {
	return cachedVersion;
}
//#endregion
export { getFrameworkVersion, getWarlockVersion };

//# sourceMappingURL=framework-vesion.mjs.map