import { environment } from "../utils/environment.mjs";
import "../utils/index.mjs";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/logger/logger.ts
function setLogConfigurations(options) {
	const channels = [];
	const envChannels = options[environment()]?.channels;
	const defaultChannels = options.channels;
	if (defaultChannels) channels.push(...defaultChannels);
	if (envChannels) channels.push(...envChannels);
	log.configure({ channels });
}
//#endregion
export { setLogConfigurations };

//# sourceMappingURL=logger.mjs.map