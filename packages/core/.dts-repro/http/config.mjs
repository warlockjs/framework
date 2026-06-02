import baseConfig from "@mongez/config";
import { get } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/http/config.ts
/**
* Default http configurations
*/
const defaultHttpConfigurations = {
	port: 3e3,
	host: "0.0.0.0",
	middleware: {
		all: [],
		only: { middleware: [] },
		except: { middleware: [] }
	}
};
/**
* Get http configurations for the given key
*/
function httpConfig(key) {
	return baseConfig.get(`http.${key}`, get(defaultHttpConfigurations, key));
}
//#endregion
export { defaultHttpConfigurations, httpConfig };

//# sourceMappingURL=config.mjs.map