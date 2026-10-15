import { cacheMiddleware } from "./cache-response-middleware";
import { concurrencyLimitMiddleware } from "./concurrency-limit.middleware";
import { idempotencyMiddleware } from "./idempotency.middleware";
import { ipFilterMiddleware } from "./ip-filter.middleware";
import { maintenanceMiddleware } from "./maintenance.middleware";
import { maxBodySizeMiddleware } from "./max-body-size.middleware";
import { rateLimitMiddleware } from "./rate-limit.middleware";

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
export const middleware = {
  cache: cacheMiddleware,
  concurrencyLimit: concurrencyLimitMiddleware,
  idempotency: idempotencyMiddleware,
  ipFilter: ipFilterMiddleware,
  maintenance: maintenanceMiddleware,
  maxBodySize: maxBodySizeMiddleware,
  rateLimit: rateLimitMiddleware,
} as const;
