import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/utils/app-log.ts
const appLog = {
	info: (module, message) => log.info("app", module, message),
	error: (module, message) => log.error("app", module, message),
	warn: (module, message) => log.warn("app", module, message),
	debug: (module, message) => log.debug("app", module, message),
	success: (module, message) => log.success("app", module, message)
};
//#endregion
export { appLog };

//# sourceMappingURL=app-log.mjs.map