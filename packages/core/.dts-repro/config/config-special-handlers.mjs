//#region ../../@warlock.js/core/src/config/config-special-handlers.ts
var ConfigSpecialHandlers = class {
	constructor() {
		this.handlers = /* @__PURE__ */ new Map();
	}
	/**
	* Register a new handler
	*/
	register(configName, handler) {
		this.handlers.set(configName, handler);
	}
	/**
	* Execute handler for the given config name
	*/
	async execute(configName, config) {
		const handler = this.handlers.get(configName);
		if (!handler) return;
		return handler(config);
	}
};
const configSpecialHandlers = new ConfigSpecialHandlers();
//#endregion
export { ConfigSpecialHandlers, configSpecialHandlers };

//# sourceMappingURL=config-special-handlers.mjs.map