import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/maintenance.middleware.d.ts
/**
 * Options for the maintenance middleware.
 */
type MaintenanceOptions = {
  /**
   * Path prefixes (ending in `*`) or exact paths to bypass even when
   * maintenance is on. Falls back to `http.maintenance.allowlist`, then
   * `["/health"]`.
   *
   * @example
   * allowlist: ["/health", "/admin/*", "/webhooks/stripe"]
   */
  allowlist?: string[];
  /**
   * Seconds advertised in the `Retry-After` header. Falls back to
   * `http.maintenance.retryAfter`, then `60`.
   */
  retryAfter?: number;
  /**
   * Override the default error message.
   */
  errorMessage?: string;
};
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
declare function maintenanceMiddleware(options?: MaintenanceOptions): Middleware;
//#endregion
export { MaintenanceOptions, maintenanceMiddleware };
//# sourceMappingURL=maintenance.middleware.d.mts.map