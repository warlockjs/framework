import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { isSet, warnOnError } from "./config-values";

/**
 * Warns when `http.trustProxy` is `true` and no `http.realIpHeader` is set.
 *
 * `true` trusts every hop, so the client IP is the leftmost `X-Forwarded-For`
 * entry, which the client writes itself whenever the edge appends to that
 * header (most load balancers do). Per-IP rate limits, `ipFilter()` and
 * idempotency scoping then key on a value the client chose. Naming the header
 * the edge overwrites (`http.realIpHeader`) closes it.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app trusts no
 * proxy (`false` or unset), or when the value is a shape the server refuses
 * at start (a number, an empty string or list).
 */
export const trustProxyCheck: DoctorCheck = warnOnError({
  name: "trust-proxy",
  run: () => {
    const trustProxy: unknown = config.get("http.trustProxy");

    if (!isSet(trustProxy) || trustProxy === false) return undefined;

    if (typeof trustProxy === "function") {
      return {
        name: "trust-proxy",
        status: "ok",
        detail: "a function in http.trustProxy decides which proxies report the client IP",
      };
    }

    const isProxyList =
      (typeof trustProxy === "string" && trustProxy.trim().length > 0) ||
      (Array.isArray(trustProxy) &&
        trustProxy.length > 0 &&
        trustProxy.every((entry) => typeof entry === "string" && entry.trim().length > 0));

    // Any other shape is refused by the server at start, with its own error.
    if (trustProxy !== true && !isProxyList) return undefined;

    if (trustProxy !== true) {
      return {
        name: "trust-proxy",
        status: "ok",
        detail: "only the configured proxies are trusted to report the client IP",
      };
    }

    const header: unknown = config.get("http.realIpHeader");

    if (typeof header === "string" && header.trim().length > 0) {
      return {
        name: "trust-proxy",
        status: "ok",
        detail: `every proxy hop is trusted; the client IP is read from ${header.trim()}`,
      };
    }

    return {
      name: "trust-proxy",
      status: "warn",
      detail:
        "http.trustProxy is true and http.realIpHeader is not set — the client IP is the " +
        "leftmost X-Forwarded-For entry, which clients can write themselves, so per-IP rate " +
        "limits and ipFilter() can be bypassed. Set http.trustProxy to your proxy addresses or " +
        'CIDR blocks, or set http.realIpHeader to the header your edge overwrites (for example "cf-connecting-ip").',
    };
  },
});
