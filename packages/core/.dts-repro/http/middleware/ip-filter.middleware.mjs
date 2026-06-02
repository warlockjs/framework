import { t } from "./inject-request-context.mjs";
import "../error-codes.mjs";
import { anyMatch } from "./utils/cidr-match.mjs";
//#region ../../@warlock.js/core/src/http/middleware/ip-filter.middleware.ts
/**
* Allow / deny requests by client IP. Fail-closed: if the IP can't be read,
* the request is rejected with 403.
*
* Reads the client IP via `request.detectIp()`, which honors `X-Real-IP` and
* `X-Forwarded-For` (Fastify is started with `trustProxy: true`). Make sure
* your upstream proxy is trustworthy — `X-Forwarded-For` is client-settable.
*
* @example
* import { middleware } from "@warlock.js/core";
*
* router.group(
*   {
*     prefix: "/admin",
*     middleware: [middleware.ipFilter({ allow: ["10.0.0.0/8", "203.0.113.42"] })],
*   },
*   () => {
*     router.get("/dashboard", dashboardController);
*   },
* );
*
* router.post("/webhooks/provider", webhookController, {
*   middleware: [middleware.ipFilter({ allow: ["198.51.100.0/24"] })],
* });
*/
function ipFilterMiddleware(options) {
	return (request, response) => {
		const ip = request.detectIp();
		if (!ip || typeof ip !== "string") return response.forbidden({
			error: options.errorMessage || t("http.ipForbidden"),
			errorCode: "EC105"
		});
		if (options.deny && anyMatch(ip, options.deny)) return response.forbidden({
			error: options.errorMessage || t("http.ipForbidden"),
			errorCode: "EC105"
		});
		if (options.allow && !anyMatch(ip, options.allow)) return response.forbidden({
			error: options.errorMessage || t("http.ipForbidden"),
			errorCode: "EC105"
		});
	};
}
//#endregion
export { ipFilterMiddleware };

//# sourceMappingURL=ip-filter.middleware.mjs.map