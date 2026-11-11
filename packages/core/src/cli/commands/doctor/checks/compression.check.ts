import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { isSet } from "./config-values";

/**
 * Reports whether responses are compressed (`http.compression`).
 *
 * INFORMATIONAL: always `ok`. Compression off is the framework default and the
 * right choice behind a proxy or CDN that already compresses, so it is never a
 * warning; the line only says how to turn it on.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app has no
 * `http` config.
 */
export const compressionCheck: DoctorCheck = {
  name: "compression",
  run: () => {
    if (!isSet(config.get("http"))) return undefined;

    const compression: unknown = config.get("http.compression");

    if (compression === true || (typeof compression === "object" && compression !== null)) {
      return {
        name: "compression",
        status: "ok",
        detail: "responses are compressed (http.compression)",
      };
    }

    return {
      name: "compression",
      status: "ok",
      detail:
        "response compression is off — set http.compression: true to send JSON and HTML " +
        "with br/gzip, unless a proxy or CDN in front of the app already compresses responses.",
    };
  },
};
