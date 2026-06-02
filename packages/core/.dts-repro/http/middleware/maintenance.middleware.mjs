import { t } from "./inject-request-context.mjs";
import "../error-codes.mjs";
import baseConfig from "@mongez/config";
//#region ../../@warlock.js/core/src/http/middleware/maintenance.middleware.ts
function isAllowlisted(path, patterns) {
	return patterns.some((pattern) => {
		if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
		return path === pattern;
	});
}
/**
* Return 503 + `Retry-After` for every request when `http.maintenance.enabled`
* is true, except for paths matching the allowlist.
*
* Designed for app-wide registration via `http.middleware.all`. Toggled via
* config — flipping the flag requires a restart (no runtime hot-flip yet).
* Allowlist defaults to `["/health"]` so health checks still pass during
* planned downtime.
*
* @example
* // src/config/http.ts
* import { middleware } from "@warlock.js/core";
*
* export default {
*   maintenance: { enabled: env("MAINTENANCE_MODE") === "true" },
*   middleware: {
*     all: [middleware.maintenance({ allowlist: ["/health", "/admin/*"] })],
*   },
* };
*/
function maintenanceMiddleware(options = {}) {
	return (request, response) => {
		if (!baseConfig.get("http.maintenance.enabled", false)) return;
		const allowlist = options.allowlist || baseConfig.get("http.maintenance.allowlist", ["/health"]);
		if (isAllowlisted(request.path, allowlist)) return;
		const retryAfter = options.retryAfter || baseConfig.get("http.maintenance.retryAfter", 60);
		response.header("Retry-After", retryAfter);
		return response.serviceUnavailable({
			error: options.errorMessage || t("http.maintenance"),
			errorCode: "EC106"
		});
	};
}
//#endregion
export { maintenanceMiddleware };

//# sourceMappingURL=maintenance.middleware.mjs.map