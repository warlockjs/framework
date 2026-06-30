import config from "@mongez/config";
import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import { t } from "./inject-request-context";

/**
 * Options for the maintenance middleware.
 */
export type MaintenanceOptions = {
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

function isAllowlisted(path: string, patterns: string[]) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("*")) {
      return path.startsWith(pattern.slice(0, -1));
    }

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
export function maintenanceMiddleware(options: MaintenanceOptions = {}): Middleware {
  return (request, response) => {
    const enabled = config.get("http.maintenance.enabled", false);

    if (!enabled) return;

    const allowlist =
      options.allowlist || config.get("http.maintenance.allowlist", ["/health"]);

    // `request.path` includes the query string, but allowlist entries are
    // path-only ("/webhooks/stripe"), so strip the query before matching —
    // otherwise "/webhooks/stripe?sig=..." never matches its exact entry.
    const pathname = request.path.split("?")[0];

    if (isAllowlisted(pathname, allowlist)) return;

    const retryAfter =
      options.retryAfter || config.get("http.maintenance.retryAfter", 60);

    response.header("Retry-After", retryAfter);

    return response.serviceUnavailable({
      error: options.errorMessage || t("http.maintenance"),
      errorCode: HttpErrorCodes.Maintenance,
    });
  };
}
