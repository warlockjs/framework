import { setBaseUrl } from "../utils/urls.mjs";
import { container } from "../container/index.mjs";
import { router } from "../router/router.mjs";
import { registerHttpPlugins } from "../http/plugins.mjs";
import { getHttpServer, startHttpServer } from "../http/server.mjs";
import { Application } from "../application/application.mjs";
import "../application/index.mjs";
import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import { devLogError } from "../dev-server/dev-logger.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/connectors/http-connector.ts
function environmentColor(environment) {
	switch (environment) {
		case "development": return colors.magentaBright(environment);
		case "test": return colors.yellowBright(environment);
		case "production": return colors.greenBright(environment);
		default: return colors.white(environment);
	}
}
/**
* HTTP Connector
* Manages HTTP server (Fastify) lifecycle
*/
var HttpConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "http";
		this.priority = 5;
		this.lifecyclePhase = "late";
		this.watchedFiles = ["src/config/http.ts", "src/config/http.tsx"];
	}
	/**
	* Boot the connector — construction only (create Fastify, register
	* plugins, populate container). Route scanning is deferred to
	* `start()` so it reads the router after app code has registered.
	*/
	async boot() {
		const httpConfig = baseConfig.get("http");
		if (!httpConfig) return;
		const port = httpConfig.port;
		log.info(`http`, "connection", `Starting http server on port ${port} in ${environmentColor(Application.environment)} mode`);
		this.http = startHttpServer(httpConfig.serverOptions);
		container.set("http.server", this.http);
		await registerHttpPlugins(this.http);
		setBaseUrl(baseConfig.get("app.baseUrl"));
	}
	/**
	* Initialize HTTP server — bind app-registered routes to Fastify
	* then listen. Scanning here (not in `boot`) lets HTTP boot before
	* app code without losing routes.
	*/
	async start() {
		const httpConfig = baseConfig.get("http");
		if (!httpConfig || !this.http) return;
		if (Application.runtimeStrategy === "development") router.scanDevServer(this.http);
		else router.scan(this.http);
		try {
			await this.http.listen({
				port: httpConfig.port,
				host: httpConfig.host || "localhost"
			});
			const baseUrl = baseConfig.get("app.baseUrl");
			log.success(`http`, "connection", `Server ready at ${baseUrl}`);
		} catch (error) {
			devLogError("Error while starting http server", error);
			process.exit(1);
		}
		this.active = true;
	}
	/**
	* Restart — needs a fresh Fastify instance since `start()` now
	* re-runs `router.scan()`, and re-scanning the same Fastify would
	* register duplicate route handlers.
	*/
	async restart() {
		await this.shutdown();
		await this.boot();
		await this.start();
	}
	/**
	* Shutdown HTTP server
	*/
	async shutdown() {
		if (!this.active) return;
		getHttpServer()?.close();
		this.active = false;
	}
	/**
	* Override shouldRestart to handle routes.ts specially
	* routes.ts changes should NOT restart the server (use HMR instead)
	* Now receives config file paths directly from layer-executor
	*/
	shouldRestart(changedFiles) {
		return changedFiles.some((file) => {
			const relativePath = file.replace(/\\/g, "/");
			return this.watchedFiles.includes(relativePath);
		});
	}
};
//#endregion
export { HttpConnector };

//# sourceMappingURL=http-connector.mjs.map