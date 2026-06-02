import { container } from "../container/index.mjs";
//#region ../../@warlock.js/core/src/application/app.ts
const app = {
	/**
	* Socket Io Instance
	* Available only if socket.io config file exists
	*/
	get socket() {
		return container.get("socket");
	},
	/**
	* HTTP Server Instance
	* Available only if http config file exists
	*/
	get http() {
		return container.get("http.server");
	},
	/**
	* Router Instance
	*/
	get router() {
		return container.get("router");
	},
	/**
	* Database Instance
	* Available only if database config file exists
	*/
	get database() {
		return container.get("database.source");
	}
};
//#endregion
export { app };

//# sourceMappingURL=app.mjs.map