import { cacheMiddleware } from "./cache-response-middleware.mjs";
import { concurrencyLimitMiddleware } from "./concurrency-limit.middleware.mjs";
import { idempotencyMiddleware } from "./idempotency.middleware.mjs";
import { ipFilterMiddleware } from "./ip-filter.middleware.mjs";
import { maintenanceMiddleware } from "./maintenance.middleware.mjs";
import { maxBodySizeMiddleware } from "./max-body-size.middleware.mjs";
import { rateLimitMiddleware } from "./rate-limit.middleware.mjs";
//#region ../../@warlock.js/core/src/http/middleware/middleware-list.ts
/**
* Built-in HTTP middleware factories.
*
* Single canonical entry point for the framework's middleware suite. Each
* property is a factory that returns a `Middleware` ready to drop into a
* route's `middleware` array.
*
* Bare names (`rateLimitMiddleware`, etc.) are not exported from the package —
* always reach for them via this namespace. The internal `*Middleware` suffix
* naming exists for in-package code organization only.
*
* @example
* import { authMiddleware } from "@warlock.js/auth";
* import { middleware, router } from "@warlock.js/core";
*
* router.post("/orders", createOrderController, {
*   middleware: [
*     authMiddleware("client"),
*     middleware.rateLimit({ max: 5, duration: 60_000 }),
*     middleware.idempotency(),
*   ],
* });
*/
const middleware = {
	cache: cacheMiddleware,
	concurrencyLimit: concurrencyLimitMiddleware,
	idempotency: idempotencyMiddleware,
	ipFilter: ipFilterMiddleware,
	maintenance: maintenanceMiddleware,
	maxBodySize: maxBodySizeMiddleware,
	rateLimit: rateLimitMiddleware
};
//#endregion
export { middleware };

//# sourceMappingURL=middleware-list.mjs.map