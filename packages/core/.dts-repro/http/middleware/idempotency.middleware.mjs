import { t } from "./inject-request-context.mjs";
import "../error-codes.mjs";
import { buildIdempotencyCacheKey, hashBody, isValidIdempotencyKey } from "./utils/idempotency-key.mjs";
import baseConfig from "@mongez/config";
import { cache } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/http/middleware/idempotency.middleware.ts
const DEFAULT_METHODS = [
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
];
/**
* Dedupe non-idempotent writes by an `Idempotency-Key` header — same key,
* same body, within TTL → cached replay; same key, different body → 422
* `IdempotencyKeyConflict`.
*
* **Must run after `authMiddleware`** — the cache key is scoped per-user
* (`idem:{userType}:{userId}:{key}`) so user A can't replay user B's key.
* Anonymous requests fall back to IP scope.
*
* The replay sets `Idempotent-Replay: true` on the response for easy
* client-side / observability detection.
*
* Eligible methods default to POST/PUT/PATCH/DELETE. GET/HEAD pass through
* even with the header set (RFC: safe methods are already idempotent).
*
* @example
* import { authMiddleware } from "@warlock.js/auth";
* import { middleware } from "@warlock.js/core";
*
* router.post("/orders", createOrderController, {
*   middleware: [authMiddleware("client"), middleware.idempotency()],
* });
*
* router.post("/ai/summarize", summarizeController, {
*   middleware: [
*     authMiddleware("client"),
*     middleware.idempotency({ ttl: 60 * 60 }), // 1h is enough for client retries
*   ],
* });
*/
function idempotencyMiddleware(options = {}) {
	return async (request, response) => {
		const headerName = options.headerName || baseConfig.get("http.idempotency.headerName", "Idempotency-Key");
		const methods = options.methods || baseConfig.get("http.idempotency.methods", DEFAULT_METHODS);
		const ttl = options.ttl || baseConfig.get("http.idempotency.ttl", 86400);
		const driverName = options.driver || baseConfig.get("http.idempotency.driver");
		if (!methods.includes(request.method.toUpperCase())) return;
		const idempotencyKey = request.header(headerName.toLowerCase());
		if (!idempotencyKey) return;
		if (!isValidIdempotencyKey(idempotencyKey)) return response.badRequest({
			error: t("http.idempotencyKeyInvalid"),
			errorCode: "EC101"
		});
		const cacheDriver = driverName ? await cache.use(driverName) : cache;
		const cacheKey = buildIdempotencyCacheKey(request, idempotencyKey);
		const bodyHash = hashBody(request.body);
		const cached = await cacheDriver.get(cacheKey);
		if (cached) {
			if (cached.bodyHash !== bodyHash) return response.unprocessableEntity({
				error: t("http.idempotencyKeyConflict"),
				errorCode: "EC100"
			});
			response.header("Idempotent-Replay", "true");
			return response.replay({
				status: cached.status,
				body: cached.body,
				contentType: cached.contentType
			});
		}
		response.onSent((sentResponse) => {
			if (sentResponse.statusCode >= 500) return;
			const sentContentType = sentResponse.contentType;
			cacheDriver.set(cacheKey, {
				status: sentResponse.statusCode,
				body: sentResponse.parsedBody,
				bodyHash,
				contentType: typeof sentContentType === "string" ? sentContentType : void 0
			}, ttl);
		});
	};
}
//#endregion
export { idempotencyMiddleware };

//# sourceMappingURL=idempotency.middleware.mjs.map