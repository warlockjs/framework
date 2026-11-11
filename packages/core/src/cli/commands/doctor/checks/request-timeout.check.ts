import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { isSet } from "./config-values";

/**
 * Warns when the request timeout is turned off (`0`).
 *
 * The timeout bounds how long a client may take to send one request, headers
 * and body. Without it a client can trickle a body forever and hold a
 * connection (and any buffered upload) open. `http.serverOptions.requestTimeout`
 * wins over `http.requestTimeout`, as it does when the server starts.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app has no
 * `http` config or sets neither key (the 5-minute default applies).
 */
export const requestTimeoutCheck: DoctorCheck = {
  name: "request-timeout",
  run: () => {
    if (!isSet(config.get("http"))) return undefined;

    const fromServerOptions: unknown = config.get("http.serverOptions.requestTimeout");
    const fromHttp: unknown = config.get("http.requestTimeout");

    const [key, timeout]: [string, unknown] = isSet(fromServerOptions)
      ? ["http.serverOptions.requestTimeout", fromServerOptions]
      : ["http.requestTimeout", fromHttp];

    // Anything but a non-negative integer leaves the server on its default.
    if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 0) return undefined;

    if (timeout === 0) {
      return {
        name: "request-timeout",
        status: "warn",
        detail:
          `${key} is 0, so the request timeout is off — a client can take forever to send a ` +
          `request and hold its connection open. Remove ${key} (default 300000 ms, 5 minutes) ` +
          "or set it to the longest a client may take to send one request.",
      };
    }

    return {
      name: "request-timeout",
      status: "ok",
      detail: `clients must send a request within ${timeout} ms (${key})`,
    };
  },
};
