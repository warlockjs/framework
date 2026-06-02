import { DatabaseLogModel } from "../database/models/database-log/database-log.mjs";
import "../database/models/database-log/index.mjs";
import { LogChannel } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/utils/database-log.ts
var DatabaseLog = class extends LogChannel {
	constructor(..._args) {
		super(..._args);
		this.name = "database";
	}
	/**
	* Database model
	*/
	get model() {
		return this.config("model") ?? DatabaseLogModel;
	}
	/**
	* {@inheritdoc}
	*/
	async log(log) {
		const { module, action, message, type: level } = log;
		if (!this.model.getDataSource().driver?.isConnected) return;
		if (!this.shouldBeLogged(log)) return;
		const data = {
			module,
			action,
			content: message,
			level,
			date: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (message instanceof Error) {
			data.stack = message.stack;
			data.content = message.message;
		} else {
			data.content = message;
			data.stack = (/* @__PURE__ */ new Error()).stack;
		}
		try {
			await this.model.create(data);
		} catch (error) {
			console.log("Error", error);
		}
	}
};
//#endregion
export { DatabaseLog };

//# sourceMappingURL=database-log.mjs.map