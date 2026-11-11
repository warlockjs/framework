import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import { t } from "./inject-request-context";
import { compileIpMatcher } from "./utils/ip-matcher";

/**
 * Options for the IP filter middleware. Use at least one of `allow` / `deny`.
 *
 * Precedence: `deny` wins. If a request matches both lists it is denied.
 */
export type IpFilterOptions = {
  /**
   * Allowlist of exact IPv4 / IPv6 addresses or IPv4 / IPv6 CIDR blocks.
   * When present, only IPs matching the list pass through.
   */
  allow?: string[];
  /**
   * Denylist of exact IPv4 / IPv6 addresses or IPv4 / IPv6 CIDR blocks.
   * Matched IPs are rejected regardless of the allowlist.
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
 * Patterns are parsed once, when the middleware is created: an entry that is
 * not an IP address or CIDR block throws then (at boot), instead of silently
 * matching nothing. IPv6 blocks (`2001:db8::/32`) match by prefix, IPv6
 * addresses compare by value, and IPv4-mapped IPv6 clients
 * (`::ffff:10.0.0.1`) match IPv4 patterns.
 *
 * Reads the client IP via `request.detectIp()`, which honors the forwarding
 * headers only when `http.trustProxy` is set — otherwise the socket peer
 * address is used, since both headers are client-settable. When opting in,
 * prefer a bounded `http.trustProxy` (a CIDR list of your proxies)
 * over `true`: with `true`, any client that can reach the process directly
 * picks its own IP and this allowlist is decorative.
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
export function ipFilterMiddleware(options: IpFilterOptions): Middleware {
  const deny = options.deny ? compileIpMatcher(options.deny, "ipFilter deny") : undefined;
  const allow = options.allow ? compileIpMatcher(options.allow, "ipFilter allow") : undefined;

  return ({ request, response }) => {
    const ip = request.detectIp();

    if (!ip || typeof ip !== "string") {
      return response.forbidden({
        error: options.errorMessage || t("http.ipForbidden"),
        errorCode: HttpErrorCodes.IpForbidden,
      });
    }

    if (deny && deny(ip)) {
      return response.forbidden({
        error: options.errorMessage || t("http.ipForbidden"),
        errorCode: HttpErrorCodes.IpForbidden,
      });
    }

    if (allow && !allow(ip)) {
      return response.forbidden({
        error: options.errorMessage || t("http.ipForbidden"),
        errorCode: HttpErrorCodes.IpForbidden,
      });
    }
  };
}
