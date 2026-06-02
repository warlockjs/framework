import { setBaseUrl } from "../utils/urls.mjs";
import { httpConfig } from "./config.mjs";
import { router } from "../router/router.mjs";
import "../router/index.mjs";
import { registerHttpPlugins } from "./plugins.mjs";
import { getHttpServer, startHttpServer } from "./server.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/http/createHttpApplication.ts
async function createHttpApplication() {
	const server = startHttpServer();
	await registerHttpPlugins(server);
	router.scan(server);
	const port = httpConfig("port");
	try {
		log.info("http", "server", "Connecting to the server");
		await server.listen({
			port,
			host: httpConfig("host")
		});
		const baseUrl = baseConfig.get("app.baseUrl");
		setBaseUrl(baseUrl);
		log.success("http", "server", `Server is listening on ${baseUrl}`);
	} catch (error) {
		log.error("http", "server", error);
		process.exit(1);
	}
}
async function stopHttpApplication() {
	log.info("http", "server", "Stopping the server");
	await getHttpServer()?.close();
	log.success("http", "server", "Server is stopped");
}
//#endregion
export { createHttpApplication, stopHttpApplication };

//# sourceMappingURL=createHttpApplication.mjs.map