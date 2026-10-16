import type { FastifyRateLimitOptions, FastifyRateLimitStore } from "@fastify/rate-limit";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import { createHash } from "node:crypto";

/**
 * Rate-limit counting shared through `@warlock.js/cache`, so every process
 * that uses the same cache driver (Redis, Postgres) counts into the same
 * buckets. With a memory driver (`memory`, `lru`, `memoryExtended`) the
 * counts stay in the process, like the in-memory limiter.
 *
 * Windows are fixed and aligned to the clock: a 60 s window resets on the
 * minute, whichever process saw the first request. Each window has its own
 * key, created atomically with a TTL of two windows and incremented with the
 * driver's atomic increment, so a key cannot expire while its window counts.
 *
 * Two drivers are refused, with {@link UnsupportedRateLimitDriverError}:
 *
 * - `null` stores nothing, so every request would count as the first and the
 *   limit would never trip.
 * - `file` has no expiry sweeper, so every past window would stay on disk
 *   forever, and its increment is only serialized within one process, so
 *   workers sharing the directory would lose counts.
 */

const KEY_PREFIX = "rate-limit";

/**
 * Cache drivers that cannot back a shared limiter (see the module comment).
 */
const UNSUPPORTED_DRIVERS = new Set(["null", "file"]);

/**
 * Thrown when `store: "cache"` runs on a cache driver that cannot count.
 */
export class UnsupportedRateLimitDriverError extends Error {
  public constructor(driverName: string) {
    super(
      `Rate limiting with store: "cache" cannot use the "${driverName}" cache driver: ` +
        (driverName === "null"
          ? "it stores nothing, so the limit would never trip. "
          : "it never removes expired windows and its increment is not shared between processes. ") +
        'Use redis or pg (or a memory driver for a single process), or set store: "memory".',
    );

    this.name = "UnsupportedRateLimitDriverError";
  }
}

function assertSupportedDriver(): void {
  const driverName = cache.currentDriver?.name;

  if (driverName && UNSUPPORTED_DRIVERS.has(driverName)) {
    throw new UnsupportedRateLimitDriverError(driverName);
  }
}

/**
 * Hash used for group keys and route namespaces before they reach the cache.
 */
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * The group key (an IP, a user id, whatever `keyGenerator` returned) is
 * hashed before it reaches the cache: cache drivers log their keys, and a raw
 * IP or email in a key is personal data in a log line.
 *
 * The namespace (it carries a route path) is hashed as well: flattening
 * `/users/:id` and `/users/id` to one safe string merged their counters, and
 * the file driver would turn `/` into directories. A readable, flattened
 * prefix stays in front of the hash for debugging.
 */
function windowKey(namespace: string, group: string, windowIndex: number): string {
  const readable = namespace.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);

  return `${KEY_PREFIX}.${readable}-${shortHash(namespace).slice(0, 16)}.${shortHash(group)}.${windowIndex}`;
}

/**
 * Count one request for `group` in the current window.
 *
 * @returns the count so far in this window and when the window resets (epoch ms)
 * @throws {UnsupportedRateLimitDriverError} on the `null` or `file` driver
 */
export async function incrementSharedRateLimit(
  namespace: string,
  group: string,
  windowMs: number,
  now: number = Date.now(),
): Promise<{ current: number; resetAt: number }> {
  assertSupportedDriver();

  const windowIndex = Math.floor(now / windowMs);
  const key = windowKey(namespace, group, windowIndex);
  const ttlSeconds = Math.max(1, Math.ceil((2 * windowMs) / 1000));

  await cache.set(key, 0, { ttl: ttlSeconds, onConflict: "create" });

  const current = await cache.increment(key, 1, { ttl: ttlSeconds });

  return { current, resetAt: (windowIndex + 1) * windowMs };
}

/**
 * Read the count for `group` in the current window without counting a request
 */
export async function readSharedRateLimit(
  namespace: string,
  group: string,
  windowMs: number,
  now: number = Date.now(),
): Promise<{ current: number; resetAt: number }> {
  assertSupportedDriver();

  const windowIndex = Math.floor(now / windowMs);
  const value = await cache.get(windowKey(namespace, group, windowIndex));

  return {
    current: typeof value === "number" ? value : 0,
    resetAt: (windowIndex + 1) * windowMs,
  };
}

/**
 * How often a failing shared store is reported. A cache outage fails every
 * request, so logging each one would flood the log.
 */
const ERROR_LOG_INTERVAL_MS = 60_000;

let lastErrorLogAt = 0;

/**
 * Log a shared rate-limit store failure, at most once per minute.
 */
export function logSharedRateLimitError(error: unknown, now: number = Date.now()): void {
  if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;

  lastErrorLogAt = now;
  log.error("http", "rate-limit", error);
}

/**
 * Forget when the last store error was logged (tests).
 */
export function resetSharedRateLimitErrorLog(): void {
  lastErrorLogAt = 0;
}

/**
 * Route data `@fastify/rate-limit` passes to `child()`: the route's options
 * under `routeInfo` (`fastify.rateLimit()` hooks pass an empty one).
 */
type ChildRouteOptions = {
  routeInfo?: { method?: unknown; url?: string; path?: string };
};

/**
 * `fastify.rateLimit()` hooks have no route; told apart by creation order,
 * which matches across processes running the same code.
 */
let nextHookNamespace = 0;

/**
 * `@fastify/rate-limit` store backed by `@warlock.js/cache`. Selected with
 * `http.rateLimit.store: "cache"`; each route with its own `rateLimit` gets
 * its own namespace through `child()`.
 *
 * A failure (cache outage, unsupported driver) is logged at most once a
 * minute and passed to the plugin, which lets the request through because
 * Warlock registers it with `skipOnError: true` for this store.
 */
export class CacheRateLimitStore implements FastifyRateLimitStore {
  public constructor(
    _options?: FastifyRateLimitOptions,
    protected readonly namespace: string = "global",
  ) {}

  public incr(
    key: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    timeWindow: number,
  ): void {
    incrementSharedRateLimit(this.namespace, key, timeWindow).then(
      ({ current, resetAt }) => callback(null, { current, ttl: Math.max(0, resetAt - Date.now()) }),
      (error: unknown) => {
        logSharedRateLimitError(error);
        callback(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  public read(
    key: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    timeWindow: number,
  ): void {
    readSharedRateLimit(this.namespace, key, timeWindow).then(
      ({ current, resetAt }) =>
        callback(null, { current, ttl: current === 0 ? 0 : Math.max(0, resetAt - Date.now()) }),
      (error: unknown) => {
        logSharedRateLimitError(error);
        callback(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  public child(routeOptions: Parameters<FastifyRateLimitStore["child"]>[0]): FastifyRateLimitStore {
    // The plugin's declared type names the route options directly, but at
    // runtime (11.x) it passes them merged under `routeInfo`.
    const routeInfo = (routeOptions as unknown as ChildRouteOptions).routeInfo ?? {};
    const method = Array.isArray(routeInfo.method)
      ? routeInfo.method.join(",")
      : String(routeInfo.method ?? "");
    const url = routeInfo.url ?? routeInfo.path ?? "";

    if (!method && !url) {
      return new CacheRateLimitStore(undefined, `hook.${nextHookNamespace++}`);
    }

    return new CacheRateLimitStore(undefined, `route.${method} ${url}`);
  }
}
