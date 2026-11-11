import { config } from "../../../../config/config-getter";
import { DEFAULT_MULTIPART_MAX_TOTAL_SIZE } from "../../../../http/multipart";
import type { DoctorCheck } from "../check.types";
import { formatBytes, isSet, warnOnError } from "./config-values";

/**
 * Above this, a multipart cap is far past what most apps accept. Every part of
 * a multipart request is held in memory while the body is read, before route
 * middleware (auth included) runs.
 */
export const UPLOAD_LIMIT_WARN_BYTES = 100 * 1024 * 1024;

/** Default for `http.fileUploadLimit`, as the multipart parser applies it. */
const DEFAULT_FILE_UPLOAD_LIMIT = 10 * 1024 * 1024;

/** A positive number of bytes, or `undefined` (the parser then uses its default). */
function bytes(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

/** `http.multipart.maxTotalSize` as the parser resolves it: a positive integer, else the default. */
function totalCap(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MULTIPART_MAX_TOTAL_SIZE;
}

/**
 * Warns when one multipart request may hold far more than 100 MB in memory.
 *
 * The cap that decides it is `http.multipart.maxTotalSize` (files and fields
 * together, per request): a file cannot pass it whatever `http.fileUploadLimit`
 * says. So an old app whose `fileUploadLimit` is in gigabytes but which keeps
 * the default total cap is bounded, and gets an `ok` line that says so.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app has no
 * `http` config or sets neither key (the defaults, 10 MB per file and 25 MB per
 * request, apply).
 */
export const uploadLimitsCheck: DoctorCheck = warnOnError({
  name: "upload-limits",
  run: () => {
    if (!isSet(config.get("http"))) return undefined;

    const configuredFile: unknown = config.get("http.fileUploadLimit");
    const configuredTotal: unknown = config.get("http.multipart.maxTotalSize");

    if (!isSet(configuredFile) && !isSet(configuredTotal)) return undefined;

    const perFile = bytes(configuredFile) ?? DEFAULT_FILE_UPLOAD_LIMIT;
    const perRequest = totalCap(configuredTotal);

    if (perRequest > UPLOAD_LIMIT_WARN_BYTES) {
      const fileToo = perFile > UPLOAD_LIMIT_WARN_BYTES;

      const found = fileToo
        ? `http.multipart.maxTotalSize is ${formatBytes(perRequest)} and http.fileUploadLimit is ${formatBytes(perFile)}`
        : `http.multipart.maxTotalSize is ${formatBytes(perRequest)}`;

      const settings = fileToo
        ? "http.multipart.maxTotalSize (default 25 MB) and http.fileUploadLimit (default 10 MB)"
        : "http.multipart.maxTotalSize (default 25 MB)";

      return {
        name: "upload-limits",
        status: "warn",
        detail:
          `${found} — one multipart request may hold that much in memory before auth runs. ` +
          `Lower ${settings} to the largest upload the app accepts, and raise the cap only on ` +
          "the routes that take large files with the route option uploads: { maxTotalSize }.",
      };
    }

    const effectiveFile = Math.min(perFile, perRequest);

    const heldBack =
      perFile > perRequest
        ? ` (http.fileUploadLimit ${formatBytes(perFile)} is held to the per-request cap)`
        : "";

    return {
      name: "upload-limits",
      status: "ok",
      detail: `uploads capped at ${formatBytes(effectiveFile)} per file and ${formatBytes(perRequest)} per request${heldBack}`,
    };
  },
});
