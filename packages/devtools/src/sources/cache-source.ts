import { currentRequestId } from "../current-request-id";
import type { DevtoolsCacheOperation, DevtoolsCollector, DevtoolsDisposer } from "../types";

/** Cache events the dashboard's waterfall and background bucket care about. */
const EVENT_TYPES = ["hit", "miss", "set", "removed", "invalidated", "flushed"] as const;

/** The shape `cache.on(event, handler)` hands the handler. */
type CacheEventData = {
  key?: string;
  driver: string;
  tags?: string[];
  keys?: string[];
  durationMs?: number;
};

/**
 * Feeds cache hits, misses and mutations, from `@warlock.js/cache`, into the
 * collector. A no-op when `@warlock.js/cache` isn't installed — it is an
 * optional peer.
 */
export async function attachCacheSource(collector: DevtoolsCollector): Promise<DevtoolsDisposer> {
  let cache: {
    on(event: (typeof EVENT_TYPES)[number], handler: (data: CacheEventData) => void): unknown;
    off(event: (typeof EVENT_TYPES)[number], handler: (data: CacheEventData) => void): unknown;
  };

  try {
    ({ cache } = await import("@warlock.js/cache"));
  } catch {
    return () => {};
  }

  const handlers = EVENT_TYPES.map((type) => {
    const handler = (data: CacheEventData) => {
      const operation: DevtoolsCacheOperation = {
        type,
        driver: data.driver,
        key: data.key,
        tags: data.tags,
        keys: data.keys,
        at: Date.now(),
        durationMs: data.durationMs,
      };

      collector.addCacheOperation(currentRequestId(), operation);
    };

    cache.on(type, handler);

    return { type, handler };
  });

  return () => {
    for (const { type, handler } of handlers) cache.off(type, handler);
  };
}
