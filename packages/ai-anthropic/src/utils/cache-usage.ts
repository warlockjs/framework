import type { Usage } from "@warlock.js/ai";

/** The cache-related fields of an Anthropic usage block (final or streamed). */
export type AnthropicCacheUsage = {
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number | null;
    ephemeral_5m_input_tokens?: number | null;
  } | null;
};

/**
 * Copy Anthropic's cache counters onto a neutral `Usage`.
 *
 * - `cache_read_input_tokens` → `cachedTokens`
 * - `cache_creation_input_tokens` → `cacheWriteTokens`
 * - `cache_creation.ephemeral_1h_input_tokens` → `cacheWrite1hTokens`
 *   (the 1-hour writes, billed at 2x input instead of 1.25x)
 *
 * When Anthropic omits the per-lifetime breakdown, `requestTtl` decides:
 * a request whose every cache marker asked for `"1h"` wrote only 1-hour
 * entries. Counters are set only when positive, so an absent channel
 * stays undefined. Anthropic's `input_tokens` excludes all of these, so
 * the caller marks the usage `inputIncludesCache: false`.
 */
export function applyAnthropicCacheUsage(
  usage: Usage,
  raw: AnthropicCacheUsage,
  requestTtl: RequestCacheTtl,
): void {
  const cacheRead = raw.cache_read_input_tokens;

  if (typeof cacheRead === "number" && cacheRead > 0) {
    usage.cachedTokens = cacheRead;
  }

  const cacheWrite = raw.cache_creation_input_tokens;

  if (typeof cacheWrite !== "number" || cacheWrite <= 0) {
    return;
  }

  usage.cacheWriteTokens = cacheWrite;

  const reported1h = raw.cache_creation?.ephemeral_1h_input_tokens;
  const writes1h =
    typeof reported1h === "number" ? reported1h : requestTtl === "1h" ? cacheWrite : 0;

  if (writes1h > 0) {
    usage.cacheWrite1hTokens = Math.min(writes1h, cacheWrite);
  }
}

/**
 * The cache lifetime a request body asked for: `"1h"` when every
 * `cache_control` marker in it says `ttl: "1h"`, `"5m"` when every marker
 * uses the default lifetime, `"mixed"` when both appear, and `undefined`
 * when the body carries no marker.
 */
export type RequestCacheTtl = "1h" | "5m" | "mixed" | undefined;

/**
 * Scan a request body (top level, system, tools, messages) for
 * `cache_control` markers and report the lifetime they request. Used only
 * as a fallback when the response lacks Anthropic's per-lifetime
 * cache-write breakdown.
 *
 * @example
 * requestCacheTtl({ cache_control: { type: "ephemeral", ttl: "1h" } }); // "1h"
 */
export function requestCacheTtl(body: unknown): RequestCacheTtl {
  let found: RequestCacheTtl;

  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || typeof value !== "object" || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }

      return;
    }

    const record = value as Record<string, unknown>;
    const marker = record.cache_control;

    if (typeof marker === "object" && marker !== null) {
      const ttl = (marker as { ttl?: unknown }).ttl === "1h" ? "1h" : "5m";
      found = found === undefined || found === ttl ? ttl : "mixed";
    }

    for (const key of ["system", "tools", "messages", "content"] as const) {
      if (key in record) {
        visit(record[key], depth + 1);
      }
    }
  };

  visit(body, 0);

  return found;
}
