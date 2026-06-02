//#region ../../@warlock.js/core/src/dev-server/health-checker/file-health-result.ts
var FileHealthResult = class {
	constructor() {
		this.result = "healthy";
		this.messages = [];
	}
	/**
	* Mark as healthy
	*/
	markAsHealthy() {
		this.result = "healthy";
	}
	/**
	* Add errors
	*/
	addErrors(messages) {
		this.result = "defective";
		this.messages.push(...messages);
	}
	/**
	* Add warnings
	*/
	addWarnings(messages) {
		this.result = "defective";
		this.messages.push(...messages);
	}
	/**
	* Get file health stats
	*/
	getStats() {
		return {
			state: this.result,
			errors: this.messages.filter((message) => message.type === "error").length,
			warnings: this.messages.filter((message) => message.type === "warning").length
		};
	}
};
//#endregion
export { FileHealthResult };

//# sourceMappingURL=file-health-result.mjs.map