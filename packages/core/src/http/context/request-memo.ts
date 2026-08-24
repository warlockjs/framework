import { requestContext, type RequestContextStore } from "./request-context";

/**
 * In-flight/settled promises for the current request, keyed by the caller's
 * key. Never a process-global map: the outer key is the request's own store
 * object (fresh per request, see `RequestContext.buildStore`), so two
 * concurrent requests can never share — or even see — each other's entries,
 * and everything is GC-eligible once the request's ALS frame ends.
 */
const requestMemoStores = new WeakMap<RequestContextStore, Map<string, Promise<any>>>();

/**
 * Single-flight, request-scoped memoization.
 *
 * The first call for a given `key` within the current request runs `fn` once
 * and caches the resulting promise; any call for the same `key` issued while
 * that promise is still pending — or after it has resolved — gets that exact
 * promise back, so parallel loaders that all need the same value never issue
 * duplicate work. A rejection is evicted immediately, so the next call for
 * that `key` retries `fn` from scratch instead of caching the failure.
 *
 * Must run inside a request context (established by
 * `createRequestStore`/`contextManager.runAll` for every HTTP request). There
 * is deliberately no process-global fallback — that is the exact cross-request
 * leak this helper exists to prevent — so calling it outside a request
 * context throws instead of silently memoizing across requests.
 */
export function requestMemo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const store = requestContext.getStore();

  if (!store) {
    throw new Error(
      "requestMemo() was called outside a request context. " +
        "It caches work for the lifetime of a single request and must run inside " +
        "code executed by the HTTP request pipeline (middleware, a loader, or a " +
        "controller) — call it from there. If you need to share a value across " +
        "requests, use a process-level cache instead; requestMemo will not fall " +
        "back to one.",
    );
  }

  let entries = requestMemoStores.get(store);

  if (!entries) {
    entries = new Map();
    requestMemoStores.set(store, entries);
  }

  const cached = entries.get(key);

  if (cached) return cached;

  const promise = (async () => fn())().catch(error => {
    entries!.delete(key);
    throw error;
  });

  entries.set(key, promise);

  return promise;
}
