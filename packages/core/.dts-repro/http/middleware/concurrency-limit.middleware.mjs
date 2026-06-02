import { t } from "./inject-request-context.mjs";
import "../error-codes.mjs";
//#region ../../@warlock.js/core/src/http/middleware/concurrency-limit.middleware.ts
const counters = /* @__PURE__ */ new Map();
function release(key) {
	const after = (counters.get(key) || 1) - 1;
	if (after <= 0) {
		counters.delete(key);
		return;
	}
	counters.set(key, after);
}
/**
* Cap the number of in-flight requests against a route. Above the cap, new
* requests get a fast 429 + `Retry-After: 1` — no queue, no timeout.
*
* Use for endpoints whose cost is unbounded per-request: report generation,
* AI completions, image processing, expensive aggregations. Different from
* `rateLimit()` — rate-limit caps requests-per-time, concurrency caps
* in-flight requests at any instant.
*
* The counter is process-local. With `N` replicas the effective cap is
* `N × max`. Document this in the route's behavior; if you need shared
* concurrency across replicas, reach for a `@warlock.js/cache` lock instead.
*
* @example
* import { middleware } from "@warlock.js/core";
*
* router.post("/reports/generate", reportController, {
*   middleware: [middleware.concurrencyLimit(3)],
* });
*
* router.post("/ai/summarize", summarizeController, {
*   middleware: [
*     middleware.concurrencyLimit(10, {
*       keyGenerator: (request) => `ai:${request.user?.id ?? request.ip}`,
*     }),
*   ],
* });
*/
function concurrencyLimitMiddleware(max, options = {}) {
	return (request, response) => {
		const key = options.keyGenerator?.(request) || request.route.path;
		const current = counters.get(key) || 0;
		if (current >= max) {
			response.header("Retry-After", 1);
			return response.tooManyRequests({
				error: options.errorMessage || t("http.concurrencyLimitReached"),
				errorCode: "EC103",
				limit: max
			});
		}
		counters.set(key, current + 1);
		let released = false;
		const releaseOnce = () => {
			if (released) return;
			released = true;
			release(key);
		};
		response.onSent((_sentResponse) => releaseOnce());
	};
}
//#endregion
export { concurrencyLimitMiddleware };

//# sourceMappingURL=concurrency-limit.middleware.mjs.map