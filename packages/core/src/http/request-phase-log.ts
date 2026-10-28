import type { LogLevel } from "@warlock.js/logger";
import { log } from "@warlock.js/logger";
import { config } from "../config/config-getter";
import type { Request } from "./request";

/**
 * Level for a per-phase request log line (start, middleware, validation,
 * handler, response). Routine progress lines (`info`, `success`) drop to
 * `debug` so a polled endpoint leaves one summary line per request, not six.
 * Warnings and errors keep their level. `http.logPhases: "info"` restores
 * the verbose output.
 */
export function phaseLogLevel(level: LogLevel = "info"): LogLevel {
  if (level !== "info" && level !== "success") return level;

  return config.key("http.logPhases") === "info" ? level : "debug";
}

/**
 * Arm the one-line request summary: written at `info` when the response
 * closes, with method, path, status, duration and request id. A 5xx is
 * skipped because it already leaves its own error record. Does nothing
 * unless `http.log` is on. Never throws.
 */
export function armRequestSummary(request: Request): void {
  try {
    if (!config.key("http.log")) return;

    const reply = request.response?.baseResponse;
    const raw = reply?.raw;

    if (!raw || typeof raw.once !== "function") return;

    raw.once("close", () => {
      try {
        const status = reply.statusCode;

        if (status >= 500) return;

        const durationMs = Date.now() - request.startTime;
        const method = request.method;
        const path = String(request.path ?? "").split("?")[0];

        log.info(
          "request",
          "completed",
          `${method} ${path} ${status} ${durationMs}ms [${request.id}]`,
          { requestId: request.id, method, path, status, durationMs },
        );
      } catch {
        // A summary line must never disturb the request.
      }
    });
  } catch {
    // Same: logging is best effort.
  }
}
