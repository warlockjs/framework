import config from "@mongez/config";
import { environment } from "../../utils/environment";
import type {
  HttpRequestLogConfig,
  RequestLogInclude,
  ResolvedRequestLogConfig,
} from "./request-log.types";

export const DEFAULT_REQUEST_LOG_SLOW_MS = 1000;
export const DEFAULT_REQUEST_LOG_MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_REQUEST_LOG_MAX_DAYS = 14;
export const DEFAULT_REQUEST_LOG_MAX_SIZE_MB = 256;

/**
 * Resolve `http.logging.requests` for the given environment. Pure: pass the
 * raw config, get every default applied.
 *
 * - `enabled`: on in development, off elsewhere.
 * - `only`: `"all"` in development, `"errors"` elsewhere.
 * - `include`: everything on in development. Elsewhere the request and
 *   response bodies are off unless set, and headers go through an allowlist.
 */
export function resolveRequestLogConfig(
  raw: HttpRequestLogConfig | undefined,
  env: string = environment(),
): ResolvedRequestLogConfig {
  const development = env === "development";
  const include: RequestLogInclude = raw?.include ?? {};
  const sampleRate = Number.isFinite(raw?.sampleRate) ? (raw?.sampleRate as number) : 1;
  const slowMs = raw?.slowMs;
  const maxBodyBytes = raw?.maxBodyBytes;
  const maxDays = raw?.retention?.maxDays;
  const maxSizeMb = raw?.retention?.maxSizeMb;

  return {
    enabled: raw?.enabled ?? development,
    channels: raw?.channels,
    only: raw?.only ?? (development ? "all" : "errors"),
    slowMs: slowMs !== undefined && slowMs >= 0 ? slowMs : DEFAULT_REQUEST_LOG_SLOW_MS,
    sampleRate: Math.min(1, Math.max(0, sampleRate)),
    include: {
      headers: include.headers ?? true,
      body: include.body ?? development,
      query: include.query ?? true,
      params: include.params ?? true,
      session: include.session ?? true,
      response: include.response ?? development,
      stack: include.stack ?? true,
      logs: include.logs ?? true,
      queries: include.queries ?? true,
      phases: include.phases ?? true,
    },
    maxBodyBytes:
      maxBodyBytes !== undefined && maxBodyBytes > 0
        ? Math.floor(maxBodyBytes)
        : DEFAULT_REQUEST_LOG_MAX_BODY_BYTES,
    retention: {
      maxDays: maxDays !== undefined && maxDays > 0 ? maxDays : DEFAULT_REQUEST_LOG_MAX_DAYS,
      maxSizeMb:
        maxSizeMb !== undefined && maxSizeMb > 0 ? maxSizeMb : DEFAULT_REQUEST_LOG_MAX_SIZE_MB,
    },
    strictHeaders: !development,
  };
}

let resolved: ResolvedRequestLogConfig | undefined;

/**
 * The request log's config, resolved once per process and cached: every
 * call site pays a field read, never a config lookup.
 */
export function getRequestLogConfig(): ResolvedRequestLogConfig {
  resolved ??= resolveRequestLogConfig(
    config.get("http.logging.requests") as HttpRequestLogConfig | undefined,
  );

  return resolved;
}

/** The single check every request makes: is the request log on? */
export function isRequestLogEnabled(): boolean {
  return getRequestLogConfig().enabled;
}

/** Test-only: forget the cached config and every runtime the request log started. */
export function resetRequestLogConfigForTests(): void {
  resolved = undefined;
}
