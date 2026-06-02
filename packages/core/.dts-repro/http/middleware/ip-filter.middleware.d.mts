import { Middleware } from "../../router/types.mjs";
//#region ../../@warlock.js/core/src/http/middleware/ip-filter.middleware.d.ts
/**
 * Options for the IP filter middleware. Use at least one of `allow` / `deny`.
 *
 * Precedence: `deny` wins. If a request matches both lists it is denied.
 */
type IpFilterOptions = {
  /**
   * Allowlist of exact IPv4 / IPv6 strings or IPv4 CIDR blocks. When present,
   * only IPs matching the list pass through.
   */
  allow?: string[];
  /**
   * Denylist of exact IPv4 / IPv6 strings or IPv4 CIDR blocks. Matched IPs
   * are rejected regardless of the allowlist.
   */
  deny?: string[];
  /**
   * Override the default error message.
   */
  errorMessage?: string;
};
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
declare function ipFilterMiddleware(options: IpFilterOptions): Middleware;
//#endregion
export { IpFilterOptions, ipFilterMiddleware };
//# sourceMappingURL=ip-filter.middleware.d.mts.map