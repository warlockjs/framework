import { config } from "../../../../config/config-getter";
import type { CheckResult, DoctorCheck } from "../check.types";
import { isSet } from "./config-values";

/** The fix every permissive verdict ends with. */
const LIST_ORIGINS =
  "List the browser origins allowed to call the API in http.cors.origin (new apps read them from CORS_ORIGINS)";

function warn(detail: string): CheckResult {
  return { name: "cors", status: "warn", detail };
}

function ok(detail: string): CheckResult {
  return { name: "cors", status: "ok", detail };
}

/**
 * Warns when CORS lets every website call the API from a browser.
 *
 * The origin is resolved the way the HTTP server resolves it: the app's
 * `http.cors` over the framework default `origin: "*"`, so an app with no
 * `origin` key is reported as `"*"`. `"*"` in a list counts as `"*"` (the CORS
 * plugin treats it so), and `true` echoes back any request's origin, which
 * together with `credentials: true` lets any site send signed-in requests and
 * read the answers.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app has no
 * `http` config.
 */
export const corsCheck: DoctorCheck = {
  name: "cors",
  run: () => {
    if (!isSet(config.get("http"))) return undefined;

    const cors: unknown = config.get("http.cors");
    const options =
      typeof cors === "object" && cors !== null ? (cors as Record<string, unknown>) : {};

    const configured = isSet(options.origin);
    const origin: unknown = configured ? options.origin : "*";
    const credentials = options.credentials === true;

    const unsetNote = configured ? "" : 'http.cors.origin is not set, so the default "*" applies: ';

    if (origin === true) {
      return credentials
        ? warn(
            "http.cors.origin is true with credentials: true — any website can send signed-in " +
              `requests to this API and read the answers. ${LIST_ORIGINS}.`,
          )
        : warn(
            "http.cors.origin is true (every origin is echoed back) — any website can call this " +
              `API from a browser and read the answers. ${LIST_ORIGINS}, or keep it only for a fully public API.`,
          );
    }

    const star = origin === "*" || (Array.isArray(origin) && origin.includes("*"));

    if (star) {
      return credentials
        ? warn(
            `${unsetNote}http.cors.origin is "*" with credentials: true — any website may call ` +
              'this API, and browsers refuse credentialed calls under "*", so your own ' +
              `frontend's cookie requests fail too. ${LIST_ORIGINS}.`,
          )
        : warn(
            `${unsetNote}http.cors.origin is "*" — any website can call this API from a browser ` +
              `and read the answers. ${LIST_ORIGINS}, or keep "*" only for a fully public API that uses no cookies.`,
          );
    }

    if (origin === false) return ok("CORS headers are off (http.cors.origin is false)");

    if (typeof origin === "function") return ok("allowed origins are decided by a function");

    if (Array.isArray(origin)) {
      return origin.length === 0
        ? ok("only same-origin browser calls (http.cors.origin is empty)")
        : ok(`cross-origin browser calls limited to ${origin.length} listed origin(s)`);
    }

    return ok("cross-origin browser calls limited to the configured origin");
  },
};
