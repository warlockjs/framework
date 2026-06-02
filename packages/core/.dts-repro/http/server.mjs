import baseConfig from "@mongez/config";
import Fastify from "fastify";
//#region ../../@warlock.js/core/src/http/server.ts
/**
* Default Fastify body limit. Kept at the historical 200GB so existing apps
* don't regress on upgrade. Override via `http.bodyLimit` in config; for
* per-route caps use the `maxBodySize()` middleware.
*/
const DEFAULT_BODY_LIMIT = 200 * 1024 * 1024 * 1024;
let server = void 0;
function startHttpServer(options) {
	return server = Fastify({
		trustProxy: true,
		bodyLimit: baseConfig.get("http.bodyLimit", DEFAULT_BODY_LIMIT),
		...options
	});
}
/**
* Expose the server to be publicly accessible
*/
function getHttpServer() {
	return server;
}
//#endregion
export { getHttpServer, startHttpServer };

//# sourceMappingURL=server.mjs.map