import { container } from "../container/index.mjs";
//#region ../../@warlock.js/core/src/socket/utils.ts
/**
* Get socket server instance
*/
function getSocketServer() {
	if (container.has("socket")) return container.get("socket");
	return null;
}
//#endregion
export { getSocketServer };

//# sourceMappingURL=utils.mjs.map