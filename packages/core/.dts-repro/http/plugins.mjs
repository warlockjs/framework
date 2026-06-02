import { rootPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import baseConfig from "@mongez/config";
import fastifyMultipart from "@fastify/multipart";
//#region ../../@warlock.js/core/src/http/plugins.ts
const defaultCorsOptions = {
	origin: "*",
	methods: "*"
};
async function registerHttpPlugins(server) {
	server.register(import("@fastify/rate-limit"), {
		max: baseConfig.get("http.rateLimit.max", 60),
		timeWindow: baseConfig.get("http.rateLimit.duration", 60 * 1e3)
	});
	const corsOptions = {
		...baseConfig.get("http.cors", {}),
		...defaultCorsOptions
	};
	server.register(import("@fastify/cors"), corsOptions);
	server.register(fastifyMultipart, {
		attachFieldsToBody: true,
		limits: { fileSize: baseConfig.get("http.fileUploadLimit", 10 * 1024 * 1024) }
	});
	server.register(import("@fastify/static"), {
		root: baseConfig.get("storage.publicRoot", rootPath("public")),
		prefix: baseConfig.get("storage.publicPrefix", "/public/")
	});
	server.register(import("@fastify/cookie"), {
		secret: baseConfig.get("http.cookies.secret"),
		parseOptions: baseConfig.get("http.cookies.options", {})
	});
}
//#endregion
export { registerHttpPlugins };

//# sourceMappingURL=plugins.mjs.map