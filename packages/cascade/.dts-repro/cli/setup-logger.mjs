import { ConsoleLog, log } from "@warlock.js/logger";
//#region ../../@warlock.js/cascade/src/cli/setup-logger.ts
/**
* Configure `@warlock.js/logger` for the standalone Cascade CLI.
*
* The logger singleton ships with **zero channels** — without configuring
* it, every `log.info` / `log.warn` / `log.error` / `log.success` call in
* the migration runner is a silent no-op. In a warlock application the
* bootstrap step registers channels; the standalone CLI has no bootstrap,
* so we do it here.
*
* Calling this replaces any previously-configured channels — safe to invoke
* multiple times to reconfigure mid-process.
*
* @example
* setLoggerConfig();
* setLoggerConfig({ minLevel: "warn" });
* setLoggerConfig({ showContext: true });
*/
function setLoggerConfig(options = {}) {
	log.configure({
		channels: [new ConsoleLog({ showContext: options.showContext })],
		minLevel: options.minLevel
	});
}
//#endregion
export { setLoggerConfig };

//# sourceMappingURL=setup-logger.mjs.map