---
description: 'Pluggable memory, LRU, file, Redis and Postgres caching: `cache`, `cached`, `CacheManager`, `TaggedCache`, `ScopedCache` and `MockCacheDriver`. Use for "cache this query", "invalidate a tenant", "stale-while-revalidate", "take a lock", tag invalidation or counters. Not this package → @warlock.js/core for HTTP response caching; @warlock.js/web for page caching; @warlock.js/cascade for persistent models.'
---

# @warlock.js/cache

The `cache` singleton (a `CacheManager`) fronts one active driver. Everything, from `get`/`set` through `remember`, `swr`, `tags`, `namespace`, `lock` and `list`, works the same on any driver, so pick a driver once and write app code against `cache`.

## The 80% path

1. Start with `cache-basics.md`.
2. Choose and configure a driver: `pick-cache-driver.md` (Postgres: `configure-pg-cache.md`; TTL and options: `configure-set-options.md`).
3. Cache expensive reads with `remember` or the `cached` wrapper: `use-cached-hof.md`, `apply-cache-patterns.md`.
4. Invalidate in groups: `use-cache-tags.md` or `use-cache-namespace.md`.
5. Stampede protection and freshness: `use-swr.md`, `use-cache-lock.md`.
6. TTL constants, key parsing and vector helpers: `use-cache-utils.md`.
7. Test with the mock driver: `test-cache-code.md`; errors and metrics: `handle-cache-errors.md`, `observe-cache.md`.

## Conventions and pitfalls

- Tags versus namespaces: tags are cross-cutting groups you flush together; a namespace is a key prefix you remove wholesale. Choose per invalidation need.
- Check `configure-set-options.md` for TTL units, and avoid `forever` for data that can go stale.
- Atomic counters, bulk ops, lists, merge and similarity have their own topics (`use-cache-atomic.md`, `use-cache-bulk.md`, `use-cache-list.md`, `use-cache-update-merge.md`, `use-cache-similarity.md`); do not hand-roll read-modify-write.
- Not every driver supports every feature; check the driver topic first.

## When to reach for it

- You need a cache abstraction that swaps drivers per environment (memory in dev, Redis in prod) without changing call sites.
- You want more than get/set — tag-based bulk invalidation, locks for stampede safety, SWR for slow upstreams, or a semantic cache over vectors.
- You're inside a Warlock app (the framework wires the driver from config) — or standalone, calling `setCacheConfigurations` + `cache.init` yourself.

Skip if a plain `Map` covers your needs and you'll never need a second driver, TTLs, or invalidation.

## The mental model in one paragraph

A single `cache` singleton fronts a configured driver. `cache.set(key, value, options?)` writes (TTL via `ttl`/`expiresAt`, inline `tags`, `onConflict`, a per-call `driver` override, or a `vector` for similarity); `cache.get` / `has` / `pull` / `remove` / `many` / `remember` read. Tags let you invalidate sets of keys you can't enumerate ahead of time; namespaces auto-prefix keys with shared TTL/tag defaults; locks serialize work across processes; SWR serves stale-but-instant while refreshing in the background; `update`/`merge` do atomic read-modify-write; `list<T>(key)` gives ordered collections; `similar(vector, …)` does nearest-neighbor retrieval. `cache.metrics()` and `cache.on(event, …)` make it observable.

## What this package deliberately doesn't do

- **Be a database.** It's a cache — entries expire, drivers may evict. Don't store anything you can't recompute.
- **Guarantee cross-driver feature parity.** Vector similarity needs a memory-family driver (`memory` / `memoryExtended` / `lru`, brute force) or `pg` with pgvector; `redis` and `file` raise `CacheUnsupportedError`. Locks/tags behave per driver. Unsupported ops raise `CacheUnsupportedError` rather than silently degrading.
- **Own your Postgres pool.** The `pg` driver takes the `pg.Pool`/`Client` you already built and never closes it — connection lifecycle stays yours. (Redis is the opposite: you pass `url`/`host` options and the driver builds and owns the client, calling `quit()` on `disconnect()`.)

## See also

- The `configure-app` topic of the `warlock-js-core` skill — wires the cache driver from `src/config/cache.ts` and exposes the singleton.
